from django.db import models



from django.db import models


class Invoice(models.Model):
    class Status(models.TextChoices):
        UPLOADED = "UPLOADED", "Uploaded"
        PROCESSING = "PROCESSING", "Processing"
        VALIDATED = "VALIDATED", "Validated"
        PENDING_APPROVAL = "PENDING_APPROVAL", "Pending Approval"
        REVIEW_REQUIRED = "REVIEW_REQUIRED", "Review Required"
        APPROVED = "APPROVED", "Approved"
        ESCALATED = "ESCALATED", "Escalated"
        REJECTED = "REJECTED", "Rejected"
        PAID = "PAID", "Paid"

    class PaymentMethod(models.TextChoices):
        BANK_TRANSFER = "BANK_TRANSFER", "Bank Transfer"
        UPI = "UPI", "UPI"
        CHEQUE = "CHEQUE", "Cheque"
        CASH = "CASH", "Cash"
        OTHER = "OTHER", "Other"

    invoice_number = models.CharField(
        max_length=100,
        null=True,
        blank=True,
    )

    vendor_name = models.CharField(
        max_length=255,
        null=True,
        blank=True,
    )

    vendor_gstin = models.CharField(
    max_length=15,
    null=True,
    blank=True,
)
    po_number = models.CharField(max_length=100, blank=True, default="")

    invoice_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)

    subtotal = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
    )

    tax_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
    )

    shipping = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
    )

    total_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
    )

    currency = models.CharField(max_length=3, default="INR")

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.UPLOADED,
    )

    # Payment tracking
    payment_date = models.DateField(null=True, blank=True)

    payment_reference = models.CharField(
        max_length=150,
        blank=True,
        default="",
    )

    payment_method = models.CharField(
        max_length=20,
        choices=PaymentMethod.choices,
        blank=True,
        default="",
    )

    document = models.FileField(
        upload_to="invoices/",
        null=True,
        blank=True,
    )

    extracted_text = models.TextField(blank=True, default="")

    validation_status = models.CharField(
        max_length=20,
        null=True,
        blank=True,
    )

    validation_errors = models.JSONField(default=list, blank=True)
    validation_warnings = models.JSONField(default=list, blank=True)

    processing_error = models.TextField(blank=True, default="")
    document_sha256 = models.CharField(max_length=64, blank=True, default="", db_index=True)
    approval_level = models.PositiveSmallIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.invoice_number} - {self.vendor_name}"


class InvoiceLineItem(models.Model):

    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.CASCADE,
        related_name="line_items",
    )

    item_code = models.CharField(
        max_length=100,
        null=True,
        blank=True,
    )

    description = models.TextField(
        null=True,
        blank=True,
    )

    quantity = models.DecimalField(
        max_digits=12,
        decimal_places=3,
        null=True,
        blank=True,
    )

    unit_price = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
    )

    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.description or 'Invoice Item'} - Invoice {self.invoice_id}"

    
class InvoiceApprovalHistory(models.Model):

    class Action(models.TextChoices):
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        ESCALATED = "ESCALATED", "Escalated"

    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.CASCADE,
        related_name="approval_history",
    )

    action = models.CharField(
        max_length=10,
        choices=Action.choices,
    )

    remarks = models.TextField(
        blank=True,
        default="",
    )
    actor_username = models.CharField(max_length=150, blank=True, default="")
    approval_level = models.PositiveSmallIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.action} - Invoice {self.invoice_id}"


class Vendor(models.Model):
    class OnboardingStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        UNDER_REVIEW = "UNDER_REVIEW", "Under Review"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"

    vendor_name = models.CharField(max_length=255)
    gstin = models.CharField(
        max_length=15,
        unique=True,
        null=True,
        blank=True,
    )
    email = models.EmailField(blank=True, default="")
    phone = models.CharField(max_length=20, blank=True, default="")
    address = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    onboarding_status = models.CharField(
        max_length=20,
        choices=OnboardingStatus.choices,
        default=OnboardingStatus.PENDING,
    )
    bank_account_name = models.CharField(max_length=255, blank=True, default="")
    bank_account_number = models.CharField(max_length=64, blank=True, default="")
    bank_ifsc = models.CharField(max_length=20, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["vendor_name"]

    def __str__(self):
        return self.vendor_name


class PurchaseOrder(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        ISSUED = "ISSUED", "Issued"
        PARTIALLY_RECEIVED = "PARTIALLY_RECEIVED", "Partially Received"
        RECEIVED = "RECEIVED", "Received"
        CANCELLED = "CANCELLED", "Cancelled"

    po_number = models.CharField(max_length=100, unique=True)
    vendor = models.ForeignKey(
        Vendor,
        on_delete=models.PROTECT,
        related_name="purchase_orders",
    )
    po_date = models.DateField()
    expected_delivery_date = models.DateField(null=True, blank=True)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tax_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-po_date", "-id"]

    def __str__(self):
        return self.po_number


class PurchaseOrderItem(models.Model):
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.CASCADE,
        related_name="items",
    )
    description = models.TextField()
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    amount = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        ordering = ["id"]


class GoodsReceiptNote(models.Model):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        PARTIALLY_RECEIVED = "PARTIALLY_RECEIVED", "Partially Received"
        COMPLETED = "COMPLETED", "Completed"

    grn_number = models.CharField(max_length=100, unique=True)
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.PROTECT,
        related_name="goods_receipts",
    )
    received_date = models.DateField()
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.OPEN,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-received_date", "-id"]

    def __str__(self):
        return self.grn_number


class GoodsReceiptItem(models.Model):
    goods_receipt = models.ForeignKey(
        GoodsReceiptNote,
        on_delete=models.CASCADE,
        related_name="items",
    )
    purchase_order_item = models.ForeignKey(
        PurchaseOrderItem,
        on_delete=models.PROTECT,
        related_name="receipt_items",
    )
    received_quantity = models.DecimalField(max_digits=12, decimal_places=3)
    accepted_quantity = models.DecimalField(max_digits=12, decimal_places=3)
    rejected_quantity = models.DecimalField(max_digits=12, decimal_places=3)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["goods_receipt", "purchase_order_item"],
                name="unique_grn_po_item",
            )
        ]


class InvoiceMatchingResult(models.Model):
    class Status(models.TextChoices):
        MATCHED = "MATCHED", "Matched"
        PARTIALLY_MATCHED = "PARTIALLY_MATCHED", "Partially Matched"
        MISMATCHED = "MISMATCHED", "Mismatched"
        NOT_FOUND = "NOT_FOUND", "Not Found"

    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.CASCADE,
        related_name="matching_results",
    )
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="matching_results",
    )
    goods_receipt = models.ForeignKey(
        GoodsReceiptNote,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="matching_results",
    )
    status = models.CharField(max_length=20, choices=Status.choices)
    exceptions = models.JSONField(default=list, blank=True)
    amount_tolerance = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
    )
    is_current = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.invoice_id}: {self.status}"


class AuditEvent(models.Model):
    actor = models.CharField(max_length=150, default="system")
    action = models.CharField(max_length=80)
    entity_type = models.CharField(max_length=40)
    entity_id = models.CharField(max_length=64)
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.action} - {self.entity_type} {self.entity_id}"


class ApprovalRule(models.Model):
    role = models.CharField(max_length=80)
    approval_level = models.PositiveSmallIntegerField()
    minimum_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    maximum_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["approval_level", "minimum_amount"]
        constraints = [
            models.UniqueConstraint(
                fields=["approval_level", "minimum_amount"],
                name="unique_approval_rule_level_minimum",
            )
        ]

    def __str__(self):
        return f"Approval level {self.approval_level}"


class VendorOnboardingHistory(models.Model):
    vendor = models.ForeignKey(
        Vendor,
        on_delete=models.CASCADE,
        related_name="onboarding_history",
    )
    previous_status = models.CharField(max_length=20, blank=True, default="")
    new_status = models.CharField(max_length=20)
    actor_username = models.CharField(max_length=150, blank=True, default="")
    remarks = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class Payment(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        PROCESSING = "PROCESSING", "Processing"
        PAID = "PAID", "Paid"
        FAILED = "FAILED", "Failed"
        CANCELLED = "CANCELLED", "Cancelled"

    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.PROTECT,
        related_name="payments",
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )
    payment_method = models.CharField(
        max_length=20,
        choices=Invoice.PaymentMethod.choices,
    )
    payment_reference = models.CharField(max_length=150, blank=True, default="")
    payment_date = models.DateField(null=True, blank=True)
    created_by = models.CharField(max_length=150, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name="payment_amount_positive",
            )
        ]