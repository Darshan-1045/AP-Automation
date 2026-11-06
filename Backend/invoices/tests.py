
from datetime import date
from datetime import timedelta
import csv
from io import StringIO
from unittest.mock import Mock, patch

from django.test import SimpleTestCase, TestCase, override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core import mail
from django.core.management import call_command
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from .matching_service import match_invoice
from .models import (
    ApprovalRule,
    AuditEvent,
    GoodsReceiptItem,
    GoodsReceiptNote,
    Invoice,
    InvoiceApprovalHistory,
    InvoiceLineItem,
    InvoiceMatchingResult,
    Payment,
    VendorOnboardingHistory,
    PurchaseOrder,
    PurchaseOrderItem,
    Vendor,
)
from .serializers import InvoiceSerializer
from .storage_backends import SupabaseInvoiceStorage


class SupabaseInvoiceStorageTests(SimpleTestCase):
    @override_settings(
        SUPABASE_URL="https://storage.example.test",
        SUPABASE_SERVICE_ROLE_KEY="test-service-role-key",
        SUPABASE_STORAGE_BUCKET="invoices",
    )
    @patch("invoices.storage_backends.create_client")
    def test_uploads_pdf_and_image_without_upsert(self, create_client):
        bucket = Mock()
        bucket.info.return_value = None
        client = Mock()
        client.storage.from_.return_value = bucket
        create_client.return_value = client
        storage = SupabaseInvoiceStorage()

        documents = (
            ("invoice.pdf", b"%PDF-1.4 test document", "application/pdf"),
            ("invoice.png", b"\x89PNG\r\n\x1a\n", "image/png"),
        )
        for filename, content, content_type in documents:
            with self.subTest(filename=filename):
                file = SimpleUploadedFile(filename, content)
                stored_name = storage.save(f"invoices/{filename}", file)

                self.assertTrue(stored_name.startswith("invoices/"))
                bucket.upload.assert_called_with(
                    stored_name,
                    content,
                    file_options={
                        "content-type": content_type,
                        "upsert": "false",
                    },
                )

    @override_settings(
        SUPABASE_URL="https://storage.example.test",
        SUPABASE_SERVICE_ROLE_KEY="test-service-role-key",
        SUPABASE_STORAGE_BUCKET="invoices",
    )
    @patch("invoices.storage_backends.create_client")
    def test_reads_private_document_metadata_and_deletes_by_object_path(
        self,
        create_client,
    ):
        bucket = Mock()
        bucket.info.return_value = {"metadata": {"size": "12"}}
        bucket.download.return_value = b"private file"
        client = Mock()
        client.storage.from_.return_value = bucket
        create_client.return_value = client
        storage = SupabaseInvoiceStorage()

        self.assertTrue(storage.exists("invoices/stored.pdf"))
        self.assertEqual(storage.size("invoices/stored.pdf"), 12)
        with storage.open("invoices/stored.pdf", "rb") as document:
            self.assertEqual(document.read(), b"private file")

        storage.delete("invoices/stored.pdf")
        bucket.remove.assert_called_once_with(["invoices/stored.pdf"])


def authenticated_client(user_label="default"):
    user_model = get_user_model()
    username = f"test-{user_label.lower().replace(' ', '-')}"
    user, _ = user_model.objects.get_or_create(username=username)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class AuthenticationTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="approval-user",
            email="approval-user@example.com",
            password="secure-test-password",
        )
        self.client = APIClient()

    def create_invoice(self, **overrides):
        data = {
            "invoice_number": "INV-AUTH-001",
            "vendor_name": "A verified vendor",
            "vendor_gstin": "27AAPFU0939F1ZV",
            "subtotal": "100.00",
            "tax_amount": "18.00",
            "shipping": "0.00",
            "total_amount": "118.00",
            "validation_status": "VALID",
            "validation_errors": [],
            "status": Invoice.Status.VALIDATED,
        }
        data.update(overrides)
        Vendor.objects.get_or_create(
            vendor_name=data["vendor_name"],
            defaults={
                "gstin": data["vendor_gstin"],
                "onboarding_status": Vendor.OnboardingStatus.APPROVED,
            },
        )
        return Invoice.objects.create(**data)

    def test_protected_invoice_endpoint_rejects_anonymous_user(self):
        response = self.client.get("/api/invoices/")
        self.assertEqual(response.status_code, 401)

    def test_application_apis_reject_anonymous_users(self):
        for path in (
            "/api/dashboard/",
            "/api/invoices/vendors/",
            "/api/invoices/payments/",
            "/api/invoices/purchase-orders/",
            "/api/invoices/goods-receipts/",
            "/api/reports/",
        ):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 401)

    def test_invoice_documents_require_authentication(self):
        invoice = self.create_invoice()
        invoice.document.save(
            "protected.pdf",
            SimpleUploadedFile(
                "protected.pdf",
                b"%PDF-1.4 protected test document",
                content_type="application/pdf",
            ),
        )
        self.addCleanup(invoice.document.delete, save=False)

        details = authenticated_client().get(
            f"/api/invoices/{invoice.pk}/"
        )
        self.assertEqual(details.status_code, 200)
        self.assertTrue(
            details.data["document_url"].endswith(
                f"/api/invoices/{invoice.pk}/document/"
            )
        )
        self.assertEqual(details.data["document"], details.data["document_url"])
        self.assertNotIn("/media/", details.data["document"])
        self.assertEqual(self.client.get(invoice.document.url).status_code, 404)

        response = self.client.get(f"/api/invoices/{invoice.pk}/document/")
        self.assertEqual(response.status_code, 401)

        response = authenticated_client().get(
            f"/api/invoices/{invoice.pk}/document/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertIn(b"protected test document", b"".join(response.streaming_content))

    def test_token_login_and_current_user_return_identity_only(self):
        response = self.client.post(
            "/api/auth/token/",
            {"email": "approval-user@example.com", "password": "secure-test-password"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["token"])
        self.assertEqual(response.data["email"], "approval-user@example.com")
        self.assertNotIn("roles", response.data)
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Token {response.data['token']}"
        )
        current_user = self.client.get("/api/auth/me/")
        self.assertEqual(current_user.status_code, 200)
        self.assertEqual(current_user.data["email"], "approval-user@example.com")
        self.assertNotIn("roles", current_user.data)
        self.assertNotIn("permissions", current_user.data)
        self.assertNotIn("capabilities", current_user.data)

    def test_registration_hashes_password_without_assigning_groups(self):
        response = self.client.post(
            "/api/auth/register/",
            {
                "full_name": "New AP User",
                "email": "New.User@example.com",
                "password": "Strong-test-password-2026",
                "confirm_password": "Strong-test-password-2026",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        user = get_user_model().objects.get(email="new.user@example.com")
        self.assertNotEqual(user.password, "Strong-test-password-2026")
        self.assertTrue(user.check_password("Strong-test-password-2026"))
        self.assertEqual(user.get_full_name(), "New AP User")
        self.assertEqual(user.groups.count(), 0)

    def test_registered_user_can_log_in_without_self_assigning_a_role(self):
        registration = self.client.post(
            "/api/auth/register/",
            {
                "full_name": "New AP User",
                "email": "new.user@example.com",
                "password": "Strong-test-password-2026",
                "confirm_password": "Strong-test-password-2026",
                "role": "Admin",
            },
            format="json",
        )
        self.assertEqual(registration.status_code, 201, registration.data)

        login = self.client.post(
            "/api/auth/token/",
            {
                "email": "new.user@example.com",
                "password": "Strong-test-password-2026",
            },
            format="json",
        )
        self.assertEqual(login.status_code, 200, login.data)

        self.client.credentials(
            HTTP_AUTHORIZATION=f"Token {login.data['token']}"
        )
        current_user = self.client.get("/api/auth/me/")
        self.assertEqual(current_user.status_code, 200, current_user.data)
        self.assertNotIn("roles", current_user.data)
        self.assertNotIn("permissions", current_user.data)
        registered_user = get_user_model().objects.get(email="new.user@example.com")
        self.assertEqual(registered_user.groups.count(), 0)

    def test_authenticated_user_can_create_vendor(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            "/api/invoices/vendors/",
            {"vendor_name": "Unauthorized Vendor"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_authenticated_user_can_create_update_and_view_vendor_and_bank_details(self):
        client = authenticated_client("vendor-operator")
        created = client.post(
            "/api/invoices/vendors/",
            {
                "vendor_name": "Authorized Vendor",
                "gstin": "27AAPFU0939F1ZV",
                "bank_account_name": "Authorized Name",
                "bank_account_number": "123456789012",
                "bank_ifsc": "ABCD0123456",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["bank_account_number"], "123456789012")

        vendor_id = created.data["id"]
        updated = client.patch(
            f"/api/invoices/vendors/{vendor_id}/",
            {
                "phone": "1234567890",
                "bank_account_number": "987654321012",
            },
            format="json",
        )
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data["phone"], "1234567890")
        self.assertEqual(updated.data["bank_account_number"], "987654321012")
        self.assertEqual(
            client.get(f"/api/invoices/vendors/{vendor_id}/").status_code,
            200,
        )

    def test_authenticated_user_can_view_vendor_bank_details(self):
        vendor = Vendor.objects.create(
            vendor_name="Bank Protected Vendor",
            bank_account_name="Protected Name",
            bank_account_number="123456789012",
            bank_ifsc="ABCD0123456",
        )
        viewer = get_user_model().objects.create_user(
            username="bank-viewer",
            password="secure-test-password",
        )
        client = APIClient()
        client.force_authenticate(user=viewer)

        response = client.get(f"/api/invoices/vendors/{vendor.pk}/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["bank_account_number"], "123456789012")
        self.assertEqual(response.data["bank_account_name"], "Protected Name")
        self.assertEqual(response.data["bank_ifsc"], "ABCD0123456")

    def test_authenticated_user_can_list_create_and_update_payment_requests(self):
        invoice = self.create_invoice(status=Invoice.Status.APPROVED)
        self.client.force_authenticate(user=self.user)
        self.assertEqual(self.client.get("/api/invoices/payments/").status_code, 200)

        created = self.client.post(
            "/api/invoices/payments/",
            {
                "invoice": invoice.pk,
                "amount": "118.00",
                "payment_method": Invoice.PaymentMethod.BANK_TRANSFER,
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)

        updated = self.client.post(
            f"/api/invoices/payments/{created.data['id']}/status/",
            {"status": Payment.Status.APPROVED},
            format="json",
        )
        self.assertEqual(updated.status_code, 200, updated.data)

        updated_again = self.client.post(
            f"/api/invoices/payments/{created.data['id']}/status/",
            {"status": Payment.Status.PROCESSING},
            format="json",
        )
        self.assertEqual(updated_again.status_code, 200, updated_again.data)

    def test_authenticated_user_can_view_all_invoices(self):
        assigned_invoice = self.create_invoice(
            invoice_number="INV-AUTH-APPROVER",
            status=Invoice.Status.VALIDATED,
        )
        second_invoice = self.create_invoice(
            invoice_number="INV-AUTH-ACCOUNTANT",
            status=Invoice.Status.VALIDATED,
            subtotal="200.00",
            total_amount="218.00",
        )
        ApprovalRule.objects.create(
            role="Unused legacy label",
            approval_level=1,
            minimum_amount="200.00",
            maximum_amount=None,
        )

        self.client.force_authenticate(user=self.user)
        response = self.client.get("/api/invoices/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            {row["id"] for row in response.data},
            {assigned_invoice.pk, second_invoice.pk},
        )
        detail = self.client.get(f"/api/invoices/{second_invoice.pk}/")
        self.assertEqual(detail.status_code, 200)

    def test_registration_rejects_duplicate_email_case_insensitively(self):
        self.user.email = "Existing@example.com"
        self.user.save(update_fields=["email"])
        response = self.client.post(
            "/api/auth/register/",
            {
                "full_name": "Duplicate User",
                "email": "existing@EXAMPLE.com",
                "password": "Strong-test-password-2026",
                "confirm_password": "Strong-test-password-2026",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data)

    def test_logout_invalidates_the_current_token(self):
        self.client.force_authenticate(user=self.user)
        token, _ = Token.objects.get_or_create(user=self.user)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        response = client.post("/api/auth/logout/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(
            Token.objects.filter(user=self.user).exists()
        )
        self.assertEqual(client.get("/api/auth/me/").status_code, 401)

    def test_authenticated_user_can_approve_valid_invoice(self):
        self.client.force_authenticate(user=self.user)
        invoice = self.create_invoice()

        response = self.client.post(
            f"/api/invoices/{invoice.pk}/approve/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)

    def test_authenticated_user_can_process_payment(self):
        self.client.force_authenticate(user=self.user)
        invoice = self.create_invoice(
            status=Invoice.Status.APPROVED,
            payment_reference="",
        )

        response = self.client.post(
            f"/api/invoices/{invoice.pk}/pay/",
            {
                "payment_date": "2026-11-05",
                "payment_reference": "UTR-AUTH-001",
                "payment_method": Invoice.PaymentMethod.BANK_TRANSFER,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)

    def test_authenticated_user_can_approve_invoice(self):
        invoice = self.create_invoice()
        response = authenticated_client().post(
            f"/api/invoices/{invoice.pk}/approve/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)


class InvoiceBulkUploadTests(TestCase):
    def setUp(self):
        self.vendor = Vendor.objects.create(
            vendor_name="ABC Technologies Pvt Ltd",
            gstin="27AAPFU0939F1ZV",
            onboarding_status=Vendor.OnboardingStatus.APPROVED,
        )

    @patch("invoices.views.extract_invoice_data")
    @patch("invoices.views.extract_invoice_text", return_value="Invoice OCR text")
    def test_bulk_upload_returns_individual_success_and_failure_results(
        self,
        _extract_text,
        extract_data,
    ):
        extract_data.return_value = {
            "invoice_number": "INV-BULK-001",
            "vendor_name": self.vendor.vendor_name,
            "vendor_gstin": self.vendor.gstin,
            "po_number": None,
            "invoice_date": "2026-10-28",
            "due_date": "2026-11-27",
            "subtotal": "100.00",
            "tax_amount": "18.00",
            "shipping": "0.00",
            "total_amount": "118.00",
            "currency": "INR",
            "line_items": [],
        }
        files = [
            SimpleUploadedFile(
                "invoice.pdf",
                b"%PDF-1.4 test document",
                content_type="application/pdf",
            ),
            SimpleUploadedFile(
                "unsupported.exe",
                b"not an invoice",
                content_type="application/octet-stream",
            ),
        ]

        response = authenticated_client().post(
            "/api/invoices/bulk/",
            {"documents": files},
            format="multipart",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Invoice.objects.count(), 1)
        self.assertEqual(
            [item["success"] for item in response.data["results"]],
            [True, False],
        )
        self.assertEqual(
            response.data["results"][0]["invoice"]["status"],
            Invoice.Status.VALIDATED,
        )
        self.assertEqual(
            set(AuditEvent.objects.values_list("action", flat=True)),
            {
                "invoice.uploaded",
                "invoice.ocr_completed",
                "invoice.validation_performed",
            },
        )
        self.assertIn(
            "pdf",
            response.data["results"][1]["error"].lower(),
        )

    def test_bulk_upload_rejects_files_with_mismatched_contents(self):
        response = authenticated_client().post(
            "/api/invoices/bulk/",
            {
                "documents": [
                    SimpleUploadedFile(
                        "invoice.pdf",
                        b"plain text, not a PDF",
                        content_type="application/pdf",
                    )
                ]
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["results"][0]["success"])
        self.assertIn("contents", response.data["results"][0]["error"])
        self.assertEqual(Invoice.objects.count(), 0)

    @patch("invoices.views.extract_invoice_data")
    @patch("invoices.views.extract_invoice_text", return_value="Invoice OCR text")
    def test_bulk_upload_detects_duplicate_document_fingerprints(
        self,
        _extract_text,
        extract_data,
    ):
        extract_data.return_value = {
            "invoice_number": "INV-FINGERPRINT-001",
            "vendor_name": self.vendor.vendor_name,
            "vendor_gstin": self.vendor.gstin,
            "invoice_date": "2026-10-28",
            "subtotal": "100.00",
            "tax_amount": "18.00",
            "shipping": "0.00",
            "total_amount": "118.00",
            "currency": "INR",
            "line_items": [],
        }
        content = b"%PDF-1.4 identical content"
        response = authenticated_client().post(
            "/api/invoices/bulk/",
            {
                "documents": [
                    SimpleUploadedFile("first.pdf", content, content_type="application/pdf"),
                    SimpleUploadedFile("duplicate.pdf", content, content_type="application/pdf"),
                ]
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            [result["success"] for result in response.data["results"]],
            [True, False],
        )
        self.assertIn("already been uploaded", response.data["results"][1]["error"])
        invoice = Invoice.objects.get()
        self.assertEqual(len(invoice.document_sha256), 64)


class InvoiceValidationTests(TestCase):

    def setUp(self):
        self.invoice_data = {
            "invoice_number": "INV-TEST-001",
            "vendor_name": "ABC Technologies Pvt Ltd",
            "invoice_date": date(2026, 10, 28),
            "due_date": date(2026, 11, 27),
            "subtotal": "10000.00",
            "tax_amount": "1800.00",
            "total_amount": "11800.00",
            "currency": "INR",
            "status": "UPLOADED",
        }

    def test_valid_invoice_is_accepted(self):
        serializer = InvoiceSerializer(data=self.invoice_data)

        self.assertTrue(
            serializer.is_valid(),
            serializer.errors,
        )

    def test_incorrect_total_is_rejected(self):
        data = {
            **self.invoice_data,
            "total_amount": "11000.00",
        }

        serializer = InvoiceSerializer(data=data)

        self.assertFalse(serializer.is_valid())
        self.assertIn("total_amount", serializer.errors)

    def test_due_date_before_invoice_date_is_rejected(self):
        data = {
            **self.invoice_data,
            "due_date": date(2026, 10, 27),
        }

        serializer = InvoiceSerializer(data=data)

        self.assertFalse(serializer.is_valid())
        self.assertIn("due_date", serializer.errors)

    def test_duplicate_invoice_is_rejected(self):
        Invoice.objects.create(**self.invoice_data)

        serializer = InvoiceSerializer(data=self.invoice_data)

        self.assertFalse(serializer.is_valid())
        self.assertIn("invoice_number", serializer.errors)


class InvoiceWorkflowTests(TestCase):
    def setUp(self):
        self.vendor = Vendor.objects.create(
            vendor_name="ABC Technologies Pvt Ltd",
            gstin="27AAPFU0939F1ZV",
            onboarding_status=Vendor.OnboardingStatus.APPROVED,
        )
        self.invoice = Invoice.objects.create(
            invoice_number="INV-WORKFLOW-001",
            vendor_name=self.vendor.vendor_name,
            vendor_gstin=self.vendor.gstin,
            total_amount="118.00",
            status=Invoice.Status.REVIEW_REQUIRED,
            validation_status="INVALID",
            validation_errors=["Invoice needs correction."],
        )
        self.client = authenticated_client("workflow-user")

    def test_review_required_invoice_can_be_rejected_with_a_reason(self):
        response = self.client.post(
            f"/api/invoices/{self.invoice.id}/reject/",
            {"remarks": "Incorrect invoice details."},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, Invoice.Status.REJECTED)
        self.assertEqual(
            self.invoice.approval_history.get().remarks,
            "Incorrect invoice details.",
        )
        self.assertTrue(
            AuditEvent.objects.filter(
                action="invoice.rejected",
                entity_id=str(self.invoice.id),
            ).exists()
        )

    def test_rejection_requires_a_reason(self):
        response = self.client.post(
            f"/api/invoices/{self.invoice.id}/reject/",
            {"remarks": "  "},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, Invoice.Status.REVIEW_REQUIRED)
        self.assertFalse(self.invoice.approval_history.exists())

    def test_inactive_vendor_cannot_be_paid(self):
        client = authenticated_client("payment-user")
        self.vendor.is_active = False
        self.vendor.save(update_fields=["is_active"])
        self.invoice.status = Invoice.Status.APPROVED
        self.invoice.validation_status = "VALID"
        self.invoice.validation_errors = []
        self.invoice.save()

        response = client.post(
            f"/api/invoices/{self.invoice.id}/pay/",
            {
                "payment_date": "2026-11-05",
                "payment_reference": "UTR-TEST-001",
                "payment_method": Invoice.PaymentMethod.BANK_TRANSFER,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("verified and active", response.data["error"])
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, Invoice.Status.APPROVED)

    def test_multi_level_approval_remains_available_to_authenticated_users(self):
        self.invoice.status = Invoice.Status.VALIDATED
        self.invoice.validation_status = "VALID"
        self.invoice.validation_errors = []
        self.invoice.save()
        ApprovalRule.objects.create(
            role="Unused legacy label 1",
            approval_level=1,
            minimum_amount="0",
        )
        ApprovalRule.objects.create(
            role="Unused legacy label 2",
            approval_level=2,
            minimum_amount="0",
        )

        first = self.client.post(
            f"/api/invoices/{self.invoice.pk}/approve/",
            {"remarks": "First review"},
            format="json",
        )
        self.assertEqual(first.status_code, 200, first.data)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, Invoice.Status.PENDING_APPROVAL)
        self.assertEqual(self.invoice.approval_level, 1)

        second = authenticated_client("second-workflow-user").post(
            f"/api/invoices/{self.invoice.pk}/approve/",
            {"remarks": "Final review"},
            format="json",
        )
        self.assertEqual(second.status_code, 200, second.data)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, Invoice.Status.APPROVED)
        self.assertEqual(self.invoice.approval_level, 2)
        self.assertEqual(
            list(
                self.invoice.approval_history.order_by("approval_level")
                .values_list("approval_level", flat=True)
            ),
            [1, 2],
        )

    def test_authenticated_user_can_read_full_vendor_bank_details(self):
        self.vendor.bank_account_name = "ABC Technologies"
        self.vendor.bank_account_number = "123456789012"
        self.vendor.bank_ifsc = "ABCD0123456"
        self.vendor.save()

        response = self.client.get(f"/api/invoices/vendors/{self.vendor.pk}/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["bank_account_number"], "123456789012")
        self.assertEqual(response.data["bank_account_name"], "ABC Technologies")
        self.assertEqual(response.data["bank_ifsc"], "ABCD0123456")

    def test_authenticated_users_can_read_vendor_bank_details(self):
        self.vendor.bank_account_number = "123456789012"
        self.vendor.save(update_fields=["bank_account_number"])
        finance_client = authenticated_client("second-vendor-user")

        response = finance_client.get(f"/api/invoices/vendors/{self.vendor.pk}/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["bank_account_number"], "123456789012")

    def test_authenticated_user_can_change_vendor_bank_details(self):
        response = self.client.patch(
            f"/api/invoices/vendors/{self.vendor.pk}/",
            {"bank_account_number": "123456789012"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)

    def test_vendor_onboarding_is_persisted_and_bank_changes_are_not_logged(self):
        manager = authenticated_client("onboarding-user")
        created = manager.post(
            "/api/invoices/vendors/",
            {
                "vendor_name": "New Onboarding Vendor",
                "gstin": "29ABCDE1234F1ZV",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)
        vendor_id = created.data["id"]
        self.assertEqual(
            created.data["onboarding_status"],
            Vendor.OnboardingStatus.PENDING,
        )

        updated = manager.patch(
            f"/api/invoices/vendors/{vendor_id}/",
            {
                "onboarding_status": Vendor.OnboardingStatus.APPROVED,
                "bank_account_name": "New Onboarding Vendor",
                "bank_account_number": "123456789012",
                "bank_ifsc": "ABCD0123456",
            },
            format="json",
        )
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(
            list(
                VendorOnboardingHistory.objects.filter(vendor_id=vendor_id)
                .order_by("created_at", "id")
                .values_list("new_status", flat=True)
            ),
            [
                Vendor.OnboardingStatus.PENDING,
                Vendor.OnboardingStatus.APPROVED,
            ],
        )
        bank_event = AuditEvent.objects.get(
            action="vendor.bank_details_updated",
            entity_id=str(vendor_id),
        )
        self.assertNotIn(
            "123456789012",
            str(bank_event.details),
        )


class PaymentRequestTests(TestCase):
    def setUp(self):
        self.vendor = Vendor.objects.create(
            vendor_name="Payment Vendor",
            gstin="27AAPFU0939F1ZV",
            onboarding_status=Vendor.OnboardingStatus.APPROVED,
        )
        self.invoice = Invoice.objects.create(
            invoice_number="INV-PAYMENT-001",
            vendor_name=self.vendor.vendor_name,
            vendor_gstin=self.vendor.gstin,
            total_amount="118.00",
            validation_status="VALID",
            validation_errors=[],
            status=Invoice.Status.APPROVED,
        )

    def test_partial_payment_requires_recorded_settlement_and_updates_balance(self):
        request_client = authenticated_client("payment-request-user")
        finance_client = authenticated_client("payment-status-user")
        first_response = request_client.post(
            "/api/invoices/payments/",
            {
                "invoice": self.invoice.pk,
                "amount": "50.00",
                "payment_method": Invoice.PaymentMethod.BANK_TRANSFER,
            },
            format="json",
        )
        self.assertEqual(first_response.status_code, 201, first_response.data)
        first_id = first_response.data["id"]
        self.assertEqual(first_response.data["status"], Payment.Status.PENDING)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, Invoice.Status.APPROVED)

        approve = finance_client.post(
            f"/api/invoices/payments/{first_id}/status/",
            {"status": Payment.Status.APPROVED},
            format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)
        process = finance_client.post(
            f"/api/invoices/payments/{first_id}/status/",
            {"status": Payment.Status.PROCESSING},
            format="json",
        )
        self.assertEqual(process.status_code, 200, process.data)
        paid = finance_client.post(
            f"/api/invoices/payments/{first_id}/status/",
            {
                "status": Payment.Status.PAID,
                "payment_date": "2026-11-05",
                "payment_reference": "UTR-PARTIAL-001",
            },
            format="json",
        )
        self.assertEqual(paid.status_code, 200, paid.data)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, Invoice.Status.APPROVED)
        self.assertEqual(paid.data["outstanding_amount"], "68.00")

        second_response = request_client.post(
            "/api/invoices/payments/",
            {
                "invoice": self.invoice.pk,
                "amount": "68.00",
                "payment_method": Invoice.PaymentMethod.BANK_TRANSFER,
            },
            format="json",
        )
        self.assertEqual(second_response.status_code, 201, second_response.data)
        second_id = second_response.data["id"]
        finance_client.post(
            f"/api/invoices/payments/{second_id}/status/",
            {"status": Payment.Status.APPROVED},
            format="json",
        )
        finance_client.post(
            f"/api/invoices/payments/{second_id}/status/",
            {"status": Payment.Status.PROCESSING},
            format="json",
        )
        final_paid = finance_client.post(
            f"/api/invoices/payments/{second_id}/status/",
            {
                "status": Payment.Status.PAID,
                "payment_date": "2026-11-06",
                "payment_reference": "UTR-PARTIAL-002",
            },
            format="json",
        )
        self.assertEqual(final_paid.status_code, 200, final_paid.data)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, Invoice.Status.PAID)
        self.assertEqual(Payment.objects.filter(invoice=self.invoice).count(), 2)

    def test_payment_request_cannot_exceed_updated_outstanding_balance(self):
        client = authenticated_client("payment-request-user")
        Payment.objects.create(
            invoice=self.invoice,
            amount="70.00",
            status=Payment.Status.PAID,
            payment_method=Invoice.PaymentMethod.BANK_TRANSFER,
        )

        response = client.post(
            "/api/invoices/payments/",
            {
                "invoice": self.invoice.pk,
                "amount": "49.00",
                "payment_method": Invoice.PaymentMethod.BANK_TRANSFER,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Payment.objects.filter(invoice=self.invoice).count(), 1)

    def test_duplicate_active_payment_request_is_rejected(self):
        client = authenticated_client("payment-request-user")
        payload = {
            "invoice": self.invoice.pk,
            "amount": "50.00",
            "payment_method": Invoice.PaymentMethod.BANK_TRANSFER,
        }

        first_response = client.post(
            "/api/invoices/payments/",
            payload,
            format="json",
        )
        duplicate_response = client.post(
            "/api/invoices/payments/",
            payload,
            format="json",
        )

        self.assertEqual(first_response.status_code, 201, first_response.data)
        self.assertEqual(duplicate_response.status_code, 400, duplicate_response.data)
        self.assertEqual(Payment.objects.filter(invoice=self.invoice).count(), 1)

    def test_rejection_requires_a_reason_and_records_the_actor(self):
        client = authenticated_client("payment-reviewer")
        created = client.post(
            "/api/invoices/payments/",
            {
                "invoice": self.invoice.pk,
                "amount": "50.00",
                "payment_method": Invoice.PaymentMethod.BANK_TRANSFER,
            },
            format="json",
        )
        payment_id = created.data["id"]

        missing_reason = client.post(
            f"/api/invoices/payments/{payment_id}/status/",
            {"status": Payment.Status.REJECTED},
            format="json",
        )
        self.assertEqual(missing_reason.status_code, 400, missing_reason.data)

        rejected = client.post(
            f"/api/invoices/payments/{payment_id}/status/",
            {
                "status": Payment.Status.REJECTED,
                "rejection_reason": "Invoice amount requires clarification.",
            },
            format="json",
        )

        self.assertEqual(rejected.status_code, 200, rejected.data)
        self.assertEqual(rejected.data["status"], Payment.Status.REJECTED)
        self.assertEqual(
            rejected.data["rejection_reason"],
            "Invoice amount requires clarification.",
        )
        event = AuditEvent.objects.get(
            action="payment.status_changed",
            entity_id=str(payment_id),
        )
        self.assertEqual(event.actor, "test-payment-reviewer")
        self.assertEqual(event.details["previous_status"], Payment.Status.PENDING)
        self.assertEqual(event.details["status"], Payment.Status.REJECTED)
        self.assertEqual(
            event.details["reason"],
            "Invoice amount requires clarification.",
        )
        self.assertIsNotNone(event.created_at)

    def test_ns_2026_0119_simulated_payment_workflow(self):
        self.vendor.vendor_name = "Northstar Office Supplies"
        self.vendor.save(update_fields=["vendor_name"])
        invoice = self.invoice
        invoice.invoice_number = "NS-2026-0119"
        invoice.vendor_name = self.vendor.vendor_name
        invoice.total_amount = "8525.50"
        invoice.currency = "INR"
        invoice.save(update_fields=[
            "invoice_number",
            "vendor_name",
            "total_amount",
            "currency",
        ])
        client = authenticated_client("payment-operator")
        created = client.post(
            "/api/invoices/payments/",
            {
                "invoice": invoice.pk,
                "amount": "8525.50",
                "payment_method": Invoice.PaymentMethod.BANK_TRANSFER,
            },
            format="json",
        )

        self.assertEqual(created.status_code, 201, created.data)
        payment_id = created.data["id"]
        self.assertEqual(created.data["status"], Payment.Status.PENDING)
        self.assertEqual(created.data["invoice_number"], "NS-2026-0119")
        self.assertEqual(created.data["vendor_name"], "Northstar Office Supplies")
        self.assertEqual(created.data["amount"], "8525.50")

        approved = client.post(
            f"/api/invoices/payments/{payment_id}/status/",
            {"status": Payment.Status.APPROVED},
            format="json",
        )
        self.assertEqual(approved.status_code, 200, approved.data)
        self.assertEqual(approved.data["status"], Payment.Status.APPROVED)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, Invoice.Status.APPROVED)

        processing = client.post(
            f"/api/invoices/payments/{payment_id}/status/",
            {"status": Payment.Status.PROCESSING},
            format="json",
        )
        self.assertEqual(processing.status_code, 200, processing.data)
        self.assertEqual(processing.data["status"], Payment.Status.PROCESSING)
        duplicate_processing = client.post(
            f"/api/invoices/payments/{payment_id}/status/",
            {"status": Payment.Status.PROCESSING},
            format="json",
        )
        self.assertEqual(duplicate_processing.status_code, 400)

        completed = client.post(
            f"/api/invoices/payments/{payment_id}/status/",
            {"status": Payment.Status.PAID},
            format="json",
        )
        self.assertEqual(completed.status_code, 200, completed.data)
        self.assertEqual(completed.data["status"], Payment.Status.PAID)
        self.assertEqual(completed.data["amount"], "8525.50")
        self.assertTrue(completed.data["payment_reference"].startswith("SIM-PAY-"))
        self.assertEqual(completed.data["payment_date"], timezone.localdate().isoformat())
        self.assertEqual(
            Payment.objects.filter(invoice=invoice, status=Payment.Status.PAID).count(),
            1,
        )
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, Invoice.Status.PAID)
        self.assertEqual(invoice.payment_reference, completed.data["payment_reference"])

        duplicate_completion = client.post(
            f"/api/invoices/payments/{payment_id}/status/",
            {"status": Payment.Status.PAID},
            format="json",
        )
        self.assertEqual(duplicate_completion.status_code, 400)

        events = AuditEvent.objects.filter(
            action="payment.status_changed",
            entity_id=str(payment_id),
        ).order_by("created_at", "id")
        self.assertEqual(events.count(), 3)
        self.assertEqual(
            list(events.values_list("actor", flat=True)),
            ["test-payment-operator"] * 3,
        )
        self.assertEqual(
            list(events.values_list("details__status", flat=True)),
            [
                Payment.Status.APPROVED,
                Payment.Status.PROCESSING,
                Payment.Status.PAID,
            ],
        )

    def test_unvalidated_invoice_cannot_start_payment_processing(self):
        client = authenticated_client("payment-operator")
        payment = Payment.objects.create(
            invoice=self.invoice,
            amount="50.00",
            status=Payment.Status.APPROVED,
            payment_method=Invoice.PaymentMethod.BANK_TRANSFER,
        )
        Invoice.objects.filter(pk=self.invoice.pk).update(
            validation_status="INVALID",
            validation_errors=["Missing required field."],
        )

        response = client.post(
            f"/api/invoices/payments/{payment.pk}/status/",
            {"status": Payment.Status.PROCESSING},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        payment.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.APPROVED)

    def test_failed_simulated_payment_requires_and_audits_reason(self):
        client = authenticated_client("payment-operator")
        created = client.post(
            "/api/invoices/payments/",
            {
                "invoice": self.invoice.pk,
                "amount": "50.00",
                "payment_method": Invoice.PaymentMethod.BANK_TRANSFER,
            },
            format="json",
        )
        payment_id = created.data["id"]
        client.post(
            f"/api/invoices/payments/{payment_id}/status/",
            {"status": Payment.Status.APPROVED},
            format="json",
        )
        client.post(
            f"/api/invoices/payments/{payment_id}/status/",
            {"status": Payment.Status.PROCESSING},
            format="json",
        )

        missing_reason = client.post(
            f"/api/invoices/payments/{payment_id}/status/",
            {"status": Payment.Status.FAILED},
            format="json",
        )
        self.assertEqual(missing_reason.status_code, 400, missing_reason.data)

        failed = client.post(
            f"/api/invoices/payments/{payment_id}/status/",
            {
                "status": Payment.Status.FAILED,
                "failure_reason": "Simulated processor declined the test payment.",
            },
            format="json",
        )
        self.assertEqual(failed.status_code, 200, failed.data)
        self.assertEqual(failed.data["status"], Payment.Status.FAILED)
        event = AuditEvent.objects.get(
            action="payment.status_changed",
            entity_id=str(payment_id),
            details__status=Payment.Status.FAILED,
        )
        self.assertEqual(event.actor, "test-payment-operator")
        self.assertEqual(
            event.details["reason"],
            "Simulated processor declined the test payment.",
        )
        self.assertIsNotNone(event.created_at)


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    DEFAULT_FROM_EMAIL="ap-test@example.com",
    AP_APPROVAL_REMINDER_HOURS=24,
    AP_APPROVAL_ESCALATION_HOURS=72,
)
class ApprovalNotificationCommandTests(TestCase):
    def setUp(self):
        self.invoice = Invoice.objects.create(
            invoice_number="INV-NOTIFY-001",
            vendor_name="Notification Vendor",
            total_amount="100.00",
            status=Invoice.Status.PENDING_APPROVAL,
            validation_status="VALID",
        )

    def add_recipient(self, email):
        user = get_user_model().objects.create_user(
            username=email,
            email=email,
            password="secure-test-password",
        )
        return user

    def test_pending_invoice_sends_a_reminder_and_records_the_event(self):
        self.add_recipient("approver@example.com")
        Invoice.objects.filter(pk=self.invoice.pk).update(
            updated_at=timezone.now() - timedelta(hours=30)
        )

        call_command("notify_pending_approvals")

        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["approver@example.com"])
        self.assertTrue(
            AuditEvent.objects.filter(
                action="invoice.approval_reminder_sent",
                entity_id=str(self.invoice.pk),
            ).exists()
        )

    def test_overdue_invoice_escalates_and_records_approval_history(self):
        self.add_recipient("manager@example.com")
        Invoice.objects.filter(pk=self.invoice.pk).update(
            updated_at=timezone.now() - timedelta(hours=96)
        )

        call_command("notify_pending_approvals")

        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, Invoice.Status.ESCALATED)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(
            self.invoice.approval_history.get().action,
            InvoiceApprovalHistory.Action.ESCALATED,
        )
        self.assertTrue(
            AuditEvent.objects.filter(
                action="invoice.escalated",
                entity_id=str(self.invoice.pk),
            ).exists()
        )


class DashboardAPIViewTests(TestCase):
    def test_dashboard_returns_database_metrics_and_unavailable_ocr_accuracy(self):
        vendor = Vendor.objects.create(
            vendor_name="Dashboard Vendor",
            gstin="27AAPFU0939F1ZV",
            onboarding_status=Vendor.OnboardingStatus.APPROVED,
        )
        invoice = Invoice.objects.create(
            invoice_number="INV-DASH-001",
            vendor_name=vendor.vendor_name,
            vendor_gstin=vendor.gstin,
            invoice_date=date(2026, 10, 1),
            due_date=timezone.localdate() - timedelta(days=10),
            total_amount="118.00",
            currency="INR",
            validation_status="VALID",
            status=Invoice.Status.VALIDATED,
        )
        AuditEvent.objects.create(
            actor="system",
            action="invoice.validation_performed",
            entity_type="invoice",
            entity_id=str(invoice.pk),
            details={"status": "VALID"},
        )

        response = authenticated_client().get("/api/dashboard/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["invoice_count"], 1)
        self.assertEqual(response.data["pending_approval_count"], 1)
        self.assertEqual(response.data["overdue_invoice_count"], 1)
        self.assertEqual(response.data["status_breakdown"], {"VALIDATED": 1})
        self.assertEqual(response.data["ocr_accuracy"]["value"], None)
        self.assertEqual(response.data["ocr_accuracy"]["label"], "Unavailable")
        self.assertEqual(response.data["vendor_analytics"][0]["vendor_name"], vendor.vendor_name)

    def test_dashboard_counts_partial_settlements_as_paid_and_outstanding(self):
        vendor = Vendor.objects.create(
            vendor_name="Partial Dashboard Vendor",
            gstin="29ABCDE1234F1ZV",
            onboarding_status=Vendor.OnboardingStatus.APPROVED,
        )
        invoice = Invoice.objects.create(
            invoice_number="INV-DASH-PARTIAL",
            vendor_name=vendor.vendor_name,
            vendor_gstin=vendor.gstin,
            total_amount="100.00",
            status=Invoice.Status.APPROVED,
        )
        Payment.objects.create(
            invoice=invoice,
            amount="25.00",
            status=Payment.Status.PAID,
            payment_method=Invoice.PaymentMethod.BANK_TRANSFER,
        )

        response = authenticated_client().get("/api/dashboard/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            response.data["currency_totals"]["INR"]["paid_value"],
            "25.00",
        )
        self.assertEqual(
            response.data["currency_totals"]["INR"]["outstanding_value"],
            "75.00",
        )


class ProcurementMatchingTests(TestCase):
    def setUp(self):
        self.vendor = Vendor.objects.create(
            vendor_name="ABC Technologies Pvt Ltd",
            gstin="27AAPFU0939F1ZV",
            onboarding_status=Vendor.OnboardingStatus.APPROVED,
        )
        self.purchase_order = PurchaseOrder.objects.create(
            po_number="PO-TEST-100",
            vendor=self.vendor,
            po_date=date(2026, 10, 1),
            subtotal="100.00",
            tax_amount="18.00",
            total_amount="118.00",
            status=PurchaseOrder.Status.ISSUED,
        )
        self.po_item = PurchaseOrderItem.objects.create(
            purchase_order=self.purchase_order,
            description="Widget",
            quantity="2.000",
            unit_price="50.00",
            amount="100.00",
        )
        self.invoice = Invoice.objects.create(
            invoice_number="INV-PO-001",
            vendor_name=self.vendor.vendor_name,
            vendor_gstin=self.vendor.gstin,
            po_number=self.purchase_order.po_number,
            invoice_date=date(2026, 10, 2),
            subtotal="100.00",
            tax_amount="18.00",
            shipping="0.00",
            total_amount="118.00",
            validation_status="VALID",
            status=Invoice.Status.VALIDATED,
        )
        self.invoice_item = InvoiceLineItem.objects.create(
            invoice=self.invoice,
            description="Widget",
            quantity="2.000",
            unit_price="50.00",
            amount="100.00",
        )

    def make_receipt(self, accepted="2.000", received="2.000"):
        receipt = GoodsReceiptNote.objects.create(
            grn_number="GRN-TEST-001",
            purchase_order=self.purchase_order,
            received_date=date(2026, 10, 3),
            status=GoodsReceiptNote.Status.COMPLETED,
        )
        GoodsReceiptItem.objects.create(
            goods_receipt=receipt,
            purchase_order_item=self.po_item,
            received_quantity=received,
            accepted_quantity=accepted,
            rejected_quantity=str(float(received) - float(accepted)),
        )
        return receipt

    def test_invoice_matches_po_and_accepted_grn_quantity(self):
        receipt = self.make_receipt()
        result = match_invoice(
            self.invoice,
            self.purchase_order,
            receipt,
        )
        self.assertEqual(result.status, InvoiceMatchingResult.Status.MATCHED)
        self.assertEqual(result.exceptions, [])

    def test_missing_grn_is_partial_and_blocks_approval(self):
        result = match_invoice(self.invoice, self.purchase_order)
        self.assertEqual(
            result.status,
            InvoiceMatchingResult.Status.PARTIALLY_MATCHED,
        )
        response = authenticated_client().post(
            f"/api/invoices/{self.invoice.id}/approve/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("matching_status", response.data)

    def test_matched_invoice_can_be_approved(self):
        receipt = self.make_receipt()
        match_invoice(self.invoice, self.purchase_order, receipt)
        response = authenticated_client().post(
            f"/api/invoices/{self.invoice.id}/approve/",
            {"remarks": "Matched to PO and GRN"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, Invoice.Status.APPROVED)

    def test_matched_approved_invoice_can_be_paid(self):
        receipt = self.make_receipt()
        match_invoice(self.invoice, self.purchase_order, receipt)
        self.invoice.status = Invoice.Status.APPROVED
        self.invoice.save(update_fields=["status"])

        response = authenticated_client().post(
            f"/api/invoices/{self.invoice.id}/pay/",
            {
                "payment_date": "2026-11-05",
                "payment_reference": "UTR-TEST-002",
                "payment_method": Invoice.PaymentMethod.BANK_TRANSFER,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, Invoice.Status.PAID)

    def test_excess_invoiced_quantity_is_persisted(self):
        receipt = self.make_receipt(accepted="1.000", received="1.000")
        result = match_invoice(
            self.invoice,
            self.purchase_order,
            receipt,
        )
        self.assertEqual(result.status, InvoiceMatchingResult.Status.MISMATCHED)
        self.assertIn(
            "EXCESS_INVOICED_QUANTITY",
            [item["code"] for item in result.exceptions],
        )

    def test_purchase_order_api_creates_nested_items_and_calculates_total(self):
        response = authenticated_client().post(
            "/api/invoices/purchase-orders/",
            {
                "po_number": "PO-API-001",
                "vendor": self.vendor.id,
                "po_date": "2026-10-10",
                "tax_amount": "18.00",
                "items": [
                    {
                        "description": "Service",
                        "quantity": "2",
                        "unit_price": "50",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["subtotal"], "100.00")
        self.assertEqual(response.data["total_amount"], "118.00")


class ExceptionReportTests(TestCase):
    def create_invoice(self, invoice_number, **overrides):
        data = {
            "invoice_number": invoice_number,
            "vendor_name": "ABC Technologies Pvt Ltd",
            "invoice_date": date(2026, 10, 28),
            "total_amount": "11800.00",
            "status": Invoice.Status.REVIEW_REQUIRED,
        }
        data.update(overrides)
        return Invoice.objects.create(**data)

    def get_exception_rows(self, params=None):
        response = authenticated_client().get(
            "/api/reports/",
            {"type": "exceptions", **(params or {})},
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["results"]

    def test_validation_errors_appear_in_exception_report(self):
        invoice = self.create_invoice(
            "INV-ERROR-001",
            validation_status="INVALID",
            validation_errors=["Total mismatch."],
        )

        rows = self.get_exception_rows()

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["invoice_number"], invoice.invoice_number)
        self.assertEqual(rows[0]["vendor_name"], invoice.vendor_name)
        self.assertIn("Validation error: Total mismatch.", rows[0]["exception_reason"])
        self.assertEqual(rows[0]["total_amount"], "11800.00")
        self.assertEqual(rows[0]["status"], Invoice.Status.REVIEW_REQUIRED)

    def test_validation_warnings_appear_in_exception_report(self):
        invoice = self.create_invoice(
            "INV-WARNING-001",
            validation_status="REVIEW_REQUIRED",
            validation_warnings=["GSTIN is missing."],
        )

        rows = self.get_exception_rows()

        self.assertEqual([row["invoice_number"] for row in rows], [invoice.invoice_number])
        self.assertIn("Validation warning: GSTIN is missing.", rows[0]["exception_reason"])

    def test_review_required_invoice_without_details_appears_in_report(self):
        invoice = self.create_invoice("INV-REVIEW-001")

        rows = self.get_exception_rows()

        self.assertEqual([row["invoice_number"] for row in rows], [invoice.invoice_number])
        self.assertEqual(rows[0]["exception_reason"], "Invoice requires manual review.")

    def test_matching_exceptions_appear_in_exception_report(self):
        invoice = self.create_invoice(
            "INV-MATCH-001",
            status=Invoice.Status.VALIDATED,
            validation_status="VALID",
        )
        InvoiceMatchingResult.objects.create(
            invoice=invoice,
            status=InvoiceMatchingResult.Status.MISMATCHED,
            exceptions=[{
                "code": "PO_NOT_FOUND",
                "message": "No purchase order was found.",
            }],
        )

        rows = self.get_exception_rows()

        self.assertEqual([row["invoice_number"] for row in rows], [invoice.invoice_number])
        self.assertEqual(rows[0]["exception_reason"], "No purchase order was found.")

    def test_successfully_matched_and_paid_invoice_is_excluded(self):
        invoice = self.create_invoice(
            "INV-PAID-001",
            status=Invoice.Status.PAID,
            validation_status="VALID",
            validation_errors=[],
            validation_warnings=[],
        )
        InvoiceMatchingResult.objects.create(
            invoice=invoice,
            status=InvoiceMatchingResult.Status.MATCHED,
            exceptions=[],
        )

        self.assertEqual(self.get_exception_rows(), [])

    def test_vendor_and_date_filters_are_applied(self):
        matching_invoice = self.create_invoice(
            "INV-ABC-001",
            vendor_name="ABC Technologies Pvt Ltd",
            invoice_date=date(2026, 10, 28),
            validation_warnings=["Review needed."],
        )
        self.create_invoice(
            "INV-OTHER-001",
            vendor_name="Other Vendor",
            invoice_date=date(2026, 10, 28),
            validation_warnings=["Review needed."],
        )
        self.create_invoice(
            "INV-OLD-001",
            vendor_name="ABC Technologies Pvt Ltd",
            invoice_date=date(2026, 9, 28),
            validation_warnings=["Review needed."],
        )

        rows = self.get_exception_rows({
            "vendor": "ABC Technologies Pvt Ltd",
            "from_date": "2026-10-01",
            "to_date": "2026-10-31",
        })

        self.assertEqual(
            [row["invoice_number"] for row in rows],
            [matching_invoice.invoice_number],
        )

    def test_status_filter_is_applied(self):
        matching_invoice = self.create_invoice(
            "INV-STATUS-001",
            validation_warnings=["Review needed."],
        )
        self.create_invoice(
            "INV-STATUS-002",
            status=Invoice.Status.VALIDATED,
            validation_warnings=["Review needed."],
        )

        rows = self.get_exception_rows({"status": Invoice.Status.REVIEW_REQUIRED})

        self.assertEqual(
            [row["invoice_number"] for row in rows],
            [matching_invoice.invoice_number],
        )


class ReportAPIViewTests(TestCase):
    def create_invoice(
        self,
        invoice_number,
        *,
        vendor_name="ABC Technologies Pvt Ltd",
        amount="100.00",
        status=Invoice.Status.APPROVED,
        invoice_date=None,
        due_date=None,
        tax_amount="18.00",
        **overrides,
    ):
        data = {
            "invoice_number": invoice_number,
            "vendor_name": vendor_name,
            "invoice_date": invoice_date or date(2026, 10, 28),
            "due_date": due_date,
            "total_amount": amount,
            "tax_amount": tax_amount,
            "status": status,
        }
        data.update(overrides)
        return Invoice.objects.create(**data)

    def get_report(self, report_type, params=None):
        response = authenticated_client().get(
            "/api/reports/",
            {"type": report_type, **(params or {})},
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_invoice_status_report_has_all_invoices_and_applies_status_filter(self):
        self.create_invoice("INV-STATUS-A", amount="100.00")
        self.create_invoice(
            "INV-STATUS-B",
            amount="250.00",
            status=Invoice.Status.REVIEW_REQUIRED,
        )

        report = self.get_report("invoice_status")
        filtered = self.get_report(
            "invoice_status",
            {"status": Invoice.Status.REVIEW_REQUIRED},
        )

        self.assertEqual(report["summary"], {
            "record_count": 2,
            "total_amount": "350.00",
        })
        self.assertEqual(report["results"][0]["currency"], "INR")
        self.assertEqual(filtered["summary"], {
            "record_count": 1,
            "total_amount": "250.00",
        })
        self.assertEqual(filtered["results"][0]["invoice_number"], "INV-STATUS-B")

    def test_aging_includes_unpaid_review_and_current_or_overdue_invoices(self):
        today = timezone.localdate()
        self.create_invoice(
            "INV-AGING-CURRENT",
            amount="100.00",
            status=Invoice.Status.APPROVED,
            due_date=today,
        )
        self.create_invoice(
            "INV-AGING-OVERDUE",
            amount="200.00",
            status=Invoice.Status.REVIEW_REQUIRED,
            due_date=today - timedelta(days=35),
        )
        self.create_invoice(
            "INV-AGING-PAID",
            amount="300.00",
            status=Invoice.Status.PAID,
            due_date=today - timedelta(days=90),
        )
        self.create_invoice(
            "INV-AGING-REJECTED",
            amount="400.00",
            status=Invoice.Status.REJECTED,
            due_date=today - timedelta(days=90),
        )

        report = self.get_report("aging")
        rows = {row["invoice_number"]: row for row in report["results"]}

        self.assertEqual(report["summary"], {
            "record_count": 2,
            "total_amount": "300.00",
        })
        self.assertEqual(rows["INV-AGING-CURRENT"]["aging_bucket"], "Current")
        self.assertEqual(rows["INV-AGING-CURRENT"]["overdue_days"], 0)
        self.assertEqual(rows["INV-AGING-OVERDUE"]["aging_bucket"], "31-60 days")
        self.assertEqual(rows["INV-AGING-OVERDUE"]["overdue_days"], 35)
        self.assertNotIn("INV-AGING-PAID", rows)
        self.assertNotIn("INV-AGING-REJECTED", rows)

    def test_aging_uses_unknown_bucket_for_missing_due_date(self):
        invoice = self.create_invoice(
            "INV-AGING-UNKNOWN",
            status=Invoice.Status.REVIEW_REQUIRED,
        )

        rows = self.get_report("aging")["results"]

        self.assertEqual(rows[0]["invoice_number"], invoice.invoice_number)
        self.assertEqual(rows[0]["aging_bucket"], "Unknown")
        self.assertIsNone(rows[0]["overdue_days"])

    def test_pending_approval_reports_validated_and_multi_level_pending_invoices(self):
        pending = self.create_invoice(
            "INV-PENDING",
            status=Invoice.Status.VALIDATED,
        )
        self.create_invoice("INV-REVIEW", status=Invoice.Status.REVIEW_REQUIRED)
        multi_level = self.create_invoice(
            "INV-MULTI-LEVEL",
            status=Invoice.Status.PENDING_APPROVAL,
            approval_level=1,
        )
        self.create_invoice(
            "INV-ESCALATED",
            status=Invoice.Status.ESCALATED,
            approval_level=1,
        )
        self.create_invoice("INV-APPROVED", status=Invoice.Status.APPROVED)
        self.create_invoice("INV-REJECTED", status=Invoice.Status.REJECTED)
        self.create_invoice("INV-PAID", status=Invoice.Status.PAID)

        report = self.get_report("pending_approval")

        self.assertEqual(report["summary"], {
            "record_count": 3,
            "total_amount": "300.00",
        })
        rows = {row["invoice_number"]: row for row in report["results"]}
        self.assertEqual(rows[pending.invoice_number]["status"], Invoice.Status.VALIDATED)
        self.assertEqual(
            rows[pending.invoice_number]["submitted_at"],
            pending.created_at.isoformat(),
        )
        self.assertEqual(rows[multi_level.invoice_number]["approval_level"], 1)
        self.assertEqual(rows["INV-ESCALATED"]["status"], Invoice.Status.ESCALATED)

    def test_payment_report_contains_recorded_and_legacy_payment_details(self):
        paid = self.create_invoice(
            "INV-PAID-REPORT",
            amount="59000.00",
            status=Invoice.Status.PAID,
            payment_date=date(2026, 11, 5),
            payment_reference="ASW-DEMO-UTR-001",
            payment_method=Invoice.PaymentMethod.BANK_TRANSFER,
        )
        self.create_invoice(
            "INV-UNPAID-REPORT",
            amount="11800.00",
            status=Invoice.Status.APPROVED,
        )
        partial = self.create_invoice(
            "INV-PARTIAL-REPORT",
            amount="100.00",
            status=Invoice.Status.APPROVED,
        )
        payment = Payment.objects.create(
            invoice=partial,
            amount="40.00",
            status=Payment.Status.PAID,
            payment_method=Invoice.PaymentMethod.UPI,
            payment_reference="UTR-PARTIAL-REPORT",
            payment_date=date(2026, 11, 6),
        )

        report = self.get_report("payments")

        self.assertEqual(report["summary"], {
            "record_count": 2,
            "total_amount": "59040.00",
        })
        recorded_row = next(
            row for row in report["results"]
            if row["payment_id"] == payment.pk
        )
        legacy_row = next(
            row for row in report["results"]
            if row["invoice_number"] == paid.invoice_number
        )
        self.assertEqual(recorded_row["payment_amount"], "40.00")
        self.assertEqual(recorded_row["payment_reference"], "UTR-PARTIAL-REPORT")
        self.assertEqual(legacy_row["payment_amount"], "59000.00")
        self.assertEqual(legacy_row["payment_reference"], "ASW-DEMO-UTR-001")
        self.assertEqual(
            legacy_row["payment_method"],
            Invoice.PaymentMethod.BANK_TRANSFER,
        )
        self.assertEqual(legacy_row["payment_date"], "2026-11-05")

    def test_vendor_report_aggregates_paid_and_outstanding_invoices(self):
        self.create_invoice(
            "INV-VENDOR-PAID",
            vendor_name="Asterwave Systems",
            amount="59000.00",
            status=Invoice.Status.PAID,
        )
        self.create_invoice(
            "INV-VENDOR-OPEN",
            vendor_name="Asterwave Systems",
            amount="11000.00",
            status=Invoice.Status.REVIEW_REQUIRED,
        )
        self.create_invoice(
            "INV-VENDOR-OTHER",
            vendor_name="Another Vendor",
            amount="900.00",
        )

        report = self.get_report("vendors", {"vendor": "asterwave systems"})

        self.assertEqual(report["summary"], {
            "record_count": 1,
            "total_amount": "70000.00",
        })
        self.assertEqual(report["results"], [{
            "vendor_name": "Asterwave Systems",
            "invoice_count": 2,
            "total_amount": "70000.00",
            "paid_amount": "59000.00",
            "outstanding_amount": "11000.00",
        }])

    def test_tax_report_sums_each_invoice_tax_once_with_filters(self):
        self.create_invoice(
            "INV-TAX-1",
            amount="100.00",
            tax_amount="9.00",
            status=Invoice.Status.PAID,
            invoice_date=date(2026, 10, 15),
        )
        self.create_invoice(
            "INV-TAX-2",
            amount="200.00",
            tax_amount="18.00",
            status=Invoice.Status.PAID,
            invoice_date=date(2026, 11, 15),
        )
        self.create_invoice(
            "INV-TAX-OTHER",
            vendor_name="Other Vendor",
            amount="300.00",
            tax_amount="27.00",
            status=Invoice.Status.PAID,
            invoice_date=date(2026, 10, 15),
        )

        report = self.get_report("tax", {
            "vendor": "ABC Technologies Pvt Ltd",
            "from_date": "2026-10-01",
            "to_date": "2026-10-31",
            "status": Invoice.Status.PAID,
        })

        self.assertEqual(report["summary"], {
            "record_count": 1,
            "total_amount": "9.00",
        })
        self.assertEqual(report["results"][0]["tax_amount"], "9.00")

    def test_po_matching_report_returns_current_matching_result(self):
        vendor = Vendor.objects.create(vendor_name="Matching Vendor")
        purchase_order = PurchaseOrder.objects.create(
            po_number="PO-REPORT-001",
            vendor=vendor,
            po_date=date(2026, 10, 1),
        )
        receipt = GoodsReceiptNote.objects.create(
            grn_number="GRN-REPORT-001",
            purchase_order=purchase_order,
            received_date=date(2026, 10, 2),
        )
        invoice = self.create_invoice(
            "INV-MATCH-REPORT",
            vendor_name=vendor.vendor_name,
            amount="500.00",
            status=Invoice.Status.APPROVED,
        )
        InvoiceMatchingResult.objects.create(
            invoice=invoice,
            purchase_order=purchase_order,
            goods_receipt=receipt,
            status=InvoiceMatchingResult.Status.MATCHED,
            exceptions=[],
            is_current=False,
        )
        current_result = InvoiceMatchingResult.objects.create(
            invoice=invoice,
            purchase_order=purchase_order,
            goods_receipt=receipt,
            status=InvoiceMatchingResult.Status.MATCHED,
            exceptions=[],
            is_current=True,
        )

        report = self.get_report("po_matching")

        self.assertEqual(report["summary"], {
            "record_count": 1,
            "total_amount": "500.00",
        })
        self.assertEqual(report["results"][0]["po_number"], purchase_order.po_number)
        self.assertEqual(report["results"][0]["grn_number"], receipt.grn_number)
        self.assertEqual(
            report["results"][0]["matching_status"],
            InvoiceMatchingResult.Status.MATCHED,
        )
        self.assertEqual(report["results"][0]["exceptions"], [])
        self.assertEqual(report["results"][0]["invoice_number"], invoice.invoice_number)
        self.assertTrue(current_result.is_current)

    def test_audit_report_lists_events_and_logs_csv_export(self):
        AuditEvent.objects.create(
            actor="test-user",
            action="invoice.uploaded",
            entity_type="invoice",
            entity_id="42",
            details={"file_type": "pdf"},
        )

        report = self.get_report("audit")

        self.assertEqual(report["summary"]["record_count"], 1)
        self.assertEqual(report["results"][0]["actor"], "test-user")
        self.assertEqual(report["results"][0]["details"], {"file_type": "pdf"})

        response = authenticated_client().get(
            "/api/reports/",
            {"type": "audit", "format": "csv"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", response["Content-Type"])
        self.assertTrue(
            AuditEvent.objects.filter(action="report.csv_exported").exists()
        )

    def test_csv_export_uses_active_filters_and_includes_displayed_total(self):
        self.create_invoice(
            "INV-CSV-MATCH",
            amount="120.00",
            status=Invoice.Status.APPROVED,
        )
        self.create_invoice(
            "INV-CSV-OTHER",
            vendor_name="Other Vendor",
            amount="999.00",
            status=Invoice.Status.APPROVED,
        )
        response = authenticated_client().get(
            "/api/reports/",
            {
                "type": "invoice_status",
                "vendor": "ABC Technologies Pvt Ltd",
                "status": Invoice.Status.APPROVED,
                "format": "csv",
            },
        )

        self.assertEqual(response.status_code, 200)
        csv_rows = list(csv.DictReader(StringIO(response.content.decode("utf-8"))))
        self.assertEqual(len(csv_rows), 2)
        self.assertEqual(csv_rows[0]["invoice_number"], "INV-CSV-MATCH")
        self.assertEqual(csv_rows[1]["vendor_name"], "Total (1 records)")
        self.assertEqual(csv_rows[1]["total_amount"], "120.00")

    def test_invalid_or_reversed_date_filters_return_clear_errors(self):
        invalid = authenticated_client().get(
            "/api/reports/",
            {"type": "invoice_status", "from_date": "not-a-date"},
        )
        reversed_dates = authenticated_client().get(
            "/api/reports/",
            {
                "type": "invoice_status",
                "from_date": "2026-11-01",
                "to_date": "2026-10-01",
            },
        )

        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(reversed_dates.status_code, 400)
