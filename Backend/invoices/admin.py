from django.contrib import admin

from .models import (
    ApprovalRule,
    GoodsReceiptItem,
    GoodsReceiptNote,
    AuditEvent,
    Invoice,
    InvoiceApprovalHistory,
    InvoiceLineItem,
    Payment,
    InvoiceMatchingResult,
    PurchaseOrder,
    PurchaseOrderItem,
    Vendor,
    VendorOnboardingHistory,
)

admin.site.register([
    Invoice,
    ApprovalRule,
    InvoiceLineItem,
    InvoiceApprovalHistory,
    InvoiceMatchingResult,
    Vendor,
    VendorOnboardingHistory,
    PurchaseOrder,
    PurchaseOrderItem,
    GoodsReceiptNote,
    GoodsReceiptItem,
    AuditEvent,
    Payment,
])
