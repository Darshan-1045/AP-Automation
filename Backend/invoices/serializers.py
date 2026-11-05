
from decimal import Decimal
import hashlib
import re
from pathlib import Path
from django.urls import reverse
from django.db import transaction
from rest_framework import serializers

from .models import (
    ApprovalRule,
    GoodsReceiptItem,
    GoodsReceiptNote,
    Invoice,
    InvoiceLineItem,
    InvoiceMatchingResult,
    Payment,
    PurchaseOrder,
    PurchaseOrderItem,
    Vendor,
)

MAX_INVOICE_FILE_SIZE = 25 * 1024 * 1024
INVOICE_FILE_SIGNATURES = {
    ".pdf": lambda content: b"%PDF-" in content[:1024],
    ".png": lambda content: content.startswith(b"\x89PNG\r\n\x1a\n"),
    ".jpg": lambda content: content.startswith(b"\xff\xd8\xff"),
    ".jpeg": lambda content: content.startswith(b"\xff\xd8\xff"),
    ".tif": lambda content: content.startswith((b"II*\x00", b"MM\x00*")),
    ".tiff": lambda content: content.startswith((b"II*\x00", b"MM\x00*")),
}


class InvoiceLineItemSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(required=False)

    class Meta:
        model = InvoiceLineItem
        fields = [
            "id",
            "item_code",
            "description",
            "quantity",
            "unit_price",
            "amount",
        ]


class InvoiceSerializer(serializers.ModelSerializer):
    extracted_text = serializers.CharField(read_only=True)
    line_items = InvoiceLineItemSerializer(many=True, required=False)
    document_url = serializers.SerializerMethodField()

    def get_document_url(self, invoice):
        if not invoice.document:
            return ""
        request = self.context.get("request")
        url = reverse("invoice-document", args=[invoice.pk])
        return request.build_absolute_uri(url) if request else url

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if instance.document:
            data["document"] = data["document_url"]
        return data

    class Meta:
        model = Invoice
        fields = "__all__"

        read_only_fields = [
            "status",
            "extracted_text",
            "validation_status",
            "validation_errors",
            "validation_warnings",
            "processing_error",
            "document_sha256",
            "created_at",
            "updated_at",
        ]

        extra_kwargs = {
            "invoice_number": {"required": False},
            "vendor_name": {"required": False},
            "invoice_date": {"required": False},
            "due_date": {"required": False},
            "subtotal": {"required": False},
            "tax_amount": {"required": False},
            "shipping": {"required": False},
            "total_amount": {"required": False},
            "currency": {"required": False},
            "document": {"required": False},
        }

    def validate_document(self, document):
        extension = Path(document.name).suffix.lower()
        signature_check = INVOICE_FILE_SIGNATURES.get(extension)
        if signature_check is None:
            raise serializers.ValidationError(
                "Upload a PDF, PNG, JPG, JPEG, TIF or TIFF document."
            )
        if document.size > MAX_INVOICE_FILE_SIZE:
            raise serializers.ValidationError(
                "Invoice documents must be 25 MB or smaller."
            )

        header = document.read(1024)
        document.seek(0)
        if not signature_check(header):
            raise serializers.ValidationError(
                "The document contents do not match its file type."
            )
        document.seek(0)
        digest = hashlib.sha256()
        for chunk in document.chunks():
            digest.update(chunk)
        document.seek(0)
        self._document_sha256 = digest.hexdigest()
        duplicate = Invoice.objects.filter(
            document_sha256=self._document_sha256,
        )
        if self.instance:
            duplicate = duplicate.exclude(pk=self.instance.pk)
        if duplicate.exists():
            raise serializers.ValidationError(
                "This exact invoice document has already been uploaded."
            )
        return document

    def create(self, validated_data):
        invoice = super().create(validated_data)
        digest = getattr(self, "_document_sha256", "")
        if digest:
            invoice.document_sha256 = digest
            invoice.save(update_fields=["document_sha256"])
        return invoice

    def validate(self, attrs):
        invoice_date = attrs.get(
            "invoice_date",
            getattr(self.instance, "invoice_date", None),
        )

        due_date = attrs.get(
            "due_date",
            getattr(self.instance, "due_date", None),
        )

        if invoice_date and due_date and due_date < invoice_date:
            raise serializers.ValidationError({
                "due_date": "Due date cannot be earlier than invoice date."
            })

        subtotal = attrs.get("subtotal", getattr(self.instance, "subtotal", None))
        tax_amount = attrs.get(
            "tax_amount",
            getattr(self.instance, "tax_amount", None),
        )
        shipping = attrs.get("shipping", getattr(self.instance, "shipping", None))
        total_amount = attrs.get(
            "total_amount",
            getattr(self.instance, "total_amount", None),
        )
        if subtotal is not None and tax_amount is not None and total_amount is not None:
            expected_total = subtotal + tax_amount + (shipping or Decimal("0"))
            if expected_total.quantize(Decimal("0.01")) != total_amount.quantize(Decimal("0.01")):
                raise serializers.ValidationError({
                    "total_amount": "Total must equal subtotal, tax, and shipping."
                })

        invoice_number = attrs.get(
            "invoice_number",
            getattr(self.instance, "invoice_number", None),
        )

        vendor_name = attrs.get(
            "vendor_name",
            getattr(self.instance, "vendor_name", None),
        )

        if invoice_number and vendor_name:
            duplicates = Invoice.objects.filter(
                invoice_number__iexact=invoice_number,
                vendor_name__iexact=vendor_name,
            )

            if self.instance:
                duplicates = duplicates.exclude(pk=self.instance.pk)

            if duplicates.exists():
                raise serializers.ValidationError({
                    "invoice_number": (
                        "This invoice number already exists for this vendor."
                    )
                })

        return attrs

    @transaction.atomic
    def update(self, instance, validated_data):
        line_items_data = validated_data.pop("line_items", None)
        document_changed = "document" in validated_data

        instance = super().update(instance, validated_data)
        digest = getattr(self, "_document_sha256", "")
        if document_changed and digest:
            instance.document_sha256 = digest
            instance.save(update_fields=["document_sha256"])

        if line_items_data is not None:
            existing_items = {
                item.id: item
                for item in instance.line_items.all()
            }

            saved_ids = set()

            for item_data in line_items_data:
                item_data = item_data.copy()
                item_id = item_data.pop("id", None)

                if item_id is not None:
                    item = existing_items.get(item_id)

                    if item is None:
                        raise serializers.ValidationError({
                            "line_items": (
                                f"Invalid line item ID: {item_id}"
                            )
                        })

                    for field, value in item_data.items():
                        setattr(item, field, value)

                    item.save()

                else:
                    item = InvoiceLineItem.objects.create(
                        invoice=instance,
                        **item_data,
                    )

                saved_ids.add(item.id)

            # Remove existing items omitted from the submitted list.
            instance.line_items.exclude(id__in=saved_ids).delete()

        return instance

class VendorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vendor
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_gstin(self, value):
        if value:
            value = value.strip().upper()
            if not re.fullmatch(r"[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]", value):
                raise serializers.ValidationError("Enter a valid 15-character GSTIN.")

            queryset = Vendor.objects.filter(gstin__iexact=value)

            if self.instance:
                queryset = queryset.exclude(pk=self.instance.pk)

            if queryset.exists():
                raise serializers.ValidationError(
                    "A vendor with this GSTIN already exists."
                )

        return value

    def validate_bank_account_number(self, value):
        value = value.strip()
        if value and not re.fullmatch(r"[0-9]{6,34}", value):
            raise serializers.ValidationError(
                "Enter a valid bank account number using digits only."
            )
        return value

    def validate_bank_ifsc(self, value):
        value = value.strip().upper()
        if value and not re.fullmatch(r"[A-Z]{4}0[A-Z0-9]{6}", value):
            raise serializers.ValidationError("Enter a valid IFSC code.")
        return value

class PaymentSerializer(serializers.ModelSerializer):
    invoice_number = serializers.CharField(source="invoice.invoice_number", read_only=True)
    vendor_name = serializers.CharField(source="invoice.vendor_name", read_only=True)
    outstanding_amount = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = [
            "id",
            "invoice",
            "invoice_number",
            "vendor_name",
            "amount",
            "status",
            "payment_method",
            "payment_reference",
            "payment_date",
            "outstanding_amount",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "invoice_number",
            "vendor_name",
            "status",
            "payment_reference",
            "payment_date",
            "outstanding_amount",
            "created_by",
            "created_at",
            "updated_at",
        ]

    def get_outstanding_amount(self, payment):
        paid = sum(
            (
                item.amount
                for item in payment.invoice.payments.filter(
                    status=Payment.Status.PAID
                )
            ),
            Decimal("0"),
        )
        return str(max((payment.invoice.total_amount or Decimal("0")) - paid, Decimal("0")))

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Payment amount must be greater than zero.")
        return value

    def validate(self, attrs):
        invoice = attrs["invoice"]
        if invoice.status != Invoice.Status.APPROVED:
            raise serializers.ValidationError({
                "invoice": "Only approved invoices can have payment requests."
            })
        total_amount = invoice.total_amount
        if total_amount is None:
            raise serializers.ValidationError({
                "invoice": "Invoice total amount is required before requesting payment."
            })
        already_paid = sum(
            (
                payment.amount for payment in invoice.payments.filter(
                    status=Payment.Status.PAID
                )
            ),
            Decimal("0"),
        )
        pending = sum(
            (
                payment.amount for payment in invoice.payments.filter(
                    status__in=[
                        Payment.Status.PENDING,
                        Payment.Status.APPROVED,
                        Payment.Status.PROCESSING,
                    ]
                )
            ),
            Decimal("0"),
        )
        if already_paid + pending + attrs["amount"] > total_amount:
            raise serializers.ValidationError({
                "amount": "Payment amount exceeds the invoice's outstanding balance."
            })
        return attrs


class PurchaseOrderItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = PurchaseOrderItem
        fields = ["id", "description", "quantity", "unit_price", "amount"]
        read_only_fields = ["id", "amount"]

    def validate_quantity(self, value):
        if value <= 0:
            raise serializers.ValidationError("Quantity must be greater than zero.")
        return value

    def validate_unit_price(self, value):
        if value < 0:
            raise serializers.ValidationError("Unit price cannot be negative.")
        return value


class PurchaseOrderSerializer(serializers.ModelSerializer):
    items = PurchaseOrderItemSerializer(many=True)

    class Meta:
        model = PurchaseOrder
        fields = [
            "id",
            "po_number",
            "vendor",
            "po_date",
            "expected_delivery_date",
            "subtotal",
            "tax_amount",
            "total_amount",
            "status",
            "items",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "subtotal", "total_amount", "created_at", "updated_at"]

    def validate(self, attrs):
        po_date = attrs.get("po_date", getattr(self.instance, "po_date", None))
        delivery_date = attrs.get(
            "expected_delivery_date",
            getattr(self.instance, "expected_delivery_date", None),
        )
        if po_date and delivery_date and delivery_date < po_date:
            raise serializers.ValidationError({
                "expected_delivery_date": "Expected delivery cannot precede the PO date."
            })
        if attrs.get("tax_amount", getattr(self.instance, "tax_amount", 0)) < 0:
            raise serializers.ValidationError({"tax_amount": "Tax cannot be negative."})
        return attrs

    @staticmethod
    def _save_items(purchase_order, items):
        purchase_order.items.all().delete()
        line_items = []
        subtotal = 0
        for item in items:
            amount = item["quantity"] * item["unit_price"]
            subtotal += amount
            line_items.append(PurchaseOrderItem(
                purchase_order=purchase_order,
                description=item["description"],
                quantity=item["quantity"],
                unit_price=item["unit_price"],
                amount=amount,
            ))
        PurchaseOrderItem.objects.bulk_create(line_items)
        purchase_order.subtotal = subtotal
        purchase_order.total_amount = subtotal + purchase_order.tax_amount
        purchase_order.save(update_fields=["subtotal", "total_amount", "updated_at"])

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("items")
        purchase_order = PurchaseOrder.objects.create(**validated_data)
        self._save_items(purchase_order, items)
        return purchase_order

    @transaction.atomic
    def update(self, instance, validated_data):
        items = validated_data.pop("items", None)
        instance = super().update(instance, validated_data)
        if items is not None:
            self._save_items(instance, items)
        elif "tax_amount" in validated_data:
            instance.total_amount = instance.subtotal + instance.tax_amount
            instance.save(update_fields=["total_amount", "updated_at"])
        return instance


class GoodsReceiptItemSerializer(serializers.ModelSerializer):
    purchase_order_item = serializers.PrimaryKeyRelatedField(
        queryset=PurchaseOrderItem.objects.all(),
    )

    class Meta:
        model = GoodsReceiptItem
        fields = [
            "id",
            "purchase_order_item",
            "received_quantity",
            "accepted_quantity",
            "rejected_quantity",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        received = attrs["received_quantity"]
        accepted = attrs["accepted_quantity"]
        rejected = attrs["rejected_quantity"]
        if received <= 0 or min(accepted, rejected) < 0 or accepted + rejected != received:
            raise serializers.ValidationError(
                "Received quantity must be positive and equal accepted plus rejected quantities."
            )
        return attrs


class GoodsReceiptNoteSerializer(serializers.ModelSerializer):
    items = GoodsReceiptItemSerializer(many=True)

    class Meta:
        model = GoodsReceiptNote
        fields = [
            "id",
            "grn_number",
            "purchase_order",
            "received_date",
            "status",
            "items",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def validate(self, attrs):
        items = attrs.get("items")
        if items is None:
            if self.instance is None:
                raise serializers.ValidationError(
                    {"items": "At least one receipt item is required."}
                )
            items = [
                {
                    "purchase_order_item": item.purchase_order_item,
                }
                for item in self.instance.items.select_related("purchase_order_item")
            ]
        if not items:
            raise serializers.ValidationError({"items": "At least one receipt item is required."})
        purchase_order = attrs.get(
            "purchase_order",
            getattr(self.instance, "purchase_order", None),
        )
        if purchase_order is None:
            raise serializers.ValidationError({"purchase_order": "A purchase order is required."})
        if purchase_order.status in {
            PurchaseOrder.Status.DRAFT,
            PurchaseOrder.Status.CANCELLED,
        }:
            raise serializers.ValidationError(
                {"purchase_order": "Receipts require an issued purchase order."}
            )
        if any(item["purchase_order_item"].purchase_order_id != purchase_order.id for item in items):
            raise serializers.ValidationError(
                {"items": "Every received item must belong to the selected purchase order."}
            )
        item_ids = [item["purchase_order_item"].id for item in items]
        if len(item_ids) != len(set(item_ids)):
            raise serializers.ValidationError(
                {"items": "A purchase order item can only appear once per GRN."}
            )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("items")
        receipt = GoodsReceiptNote.objects.create(**validated_data)
        GoodsReceiptItem.objects.bulk_create([
            GoodsReceiptItem(goods_receipt=receipt, **item)
            for item in items
        ])
        return receipt

    @transaction.atomic
    def update(self, instance, validated_data):
        items = validated_data.pop("items", None)
        instance = super().update(instance, validated_data)
        if items is not None:
            instance.items.all().delete()
            GoodsReceiptItem.objects.bulk_create([
                GoodsReceiptItem(goods_receipt=instance, **item)
                for item in items
            ])
        return instance


class InvoiceMatchingResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceMatchingResult
        fields = "__all__"