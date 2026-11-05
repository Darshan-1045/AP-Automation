from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import generics, serializers, status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .audit import record_audit_event
from .matching_service import match_invoice
from .models import (
    GoodsReceiptNote,
    GoodsReceiptItem,
    Invoice,
    InvoiceMatchingResult,
    PurchaseOrder,
)
from .serializers import (
    GoodsReceiptNoteSerializer,
    InvoiceMatchingResultSerializer,
    PurchaseOrderSerializer,
)


def _refresh_purchase_order_status(purchase_order):
    if purchase_order.status in {
        PurchaseOrder.Status.DRAFT,
        PurchaseOrder.Status.CANCELLED,
    }:
        return
    ordered_items = list(purchase_order.items.all())
    accepted_quantities = {
        row["purchase_order_item_id"]: row["accepted_total"]
        for row in GoodsReceiptItem.objects.filter(
            purchase_order_item__purchase_order=purchase_order
        ).values("purchase_order_item_id").annotate(
            accepted_total=Sum("accepted_quantity")
        )
    }
    if ordered_items and all(
        accepted_quantities.get(item.id, 0) >= item.quantity
        for item in ordered_items
    ):
        new_status = PurchaseOrder.Status.RECEIVED
    elif any(accepted_quantities.values()):
        new_status = PurchaseOrder.Status.PARTIALLY_RECEIVED
    else:
        new_status = PurchaseOrder.Status.ISSUED
    if purchase_order.status != new_status:
        purchase_order.status = new_status
        purchase_order.save(update_fields=["status", "updated_at"])


class PurchaseOrderListCreateAPIView(generics.ListCreateAPIView):
    serializer_class = PurchaseOrderSerializer

    def get_queryset(self):
        queryset = PurchaseOrder.objects.select_related("vendor").prefetch_related("items")
        status_filter = self.request.query_params.get("status")
        vendor_filter = self.request.query_params.get("vendor")
        search = self.request.query_params.get("search", "").strip()
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        if vendor_filter:
            queryset = queryset.filter(vendor_id=vendor_filter)
        if search:
            queryset = queryset.filter(
                Q(po_number__icontains=search)
                | Q(vendor__vendor_name__icontains=search)
            )
        return queryset

    def perform_create(self, serializer):
        purchase_order = serializer.save()
        record_audit_event(
            self.request,
            "purchase_order.created",
            "purchase_order",
            purchase_order.pk,
            {"po_number": purchase_order.po_number},
        )


class PurchaseOrderDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = PurchaseOrderSerializer
    queryset = PurchaseOrder.objects.select_related("vendor").prefetch_related("items")

    def perform_update(self, serializer):
        if self.get_object().status != PurchaseOrder.Status.DRAFT:
            raise ValidationError("Only draft purchase orders can be edited.")
        instance = serializer.save()
        InvoiceMatchingResult.objects.filter(
            purchase_order=instance,
            is_current=True,
        ).update(is_current=False)
        record_audit_event(
            self.request,
            "purchase_order.updated",
            "purchase_order",
            instance.pk,
            {"fields": sorted(serializer.validated_data.keys())},
        )

    def perform_destroy(self, instance):
        if instance.status != PurchaseOrder.Status.DRAFT:
            raise ValidationError("Only draft purchase orders can be deleted.")
        if instance.goods_receipts.exists() or instance.matching_results.exists():
            raise ValidationError("A purchase order with receipts or matching history cannot be deleted.")
        record_audit_event(
            self.request,
            "purchase_order.deleted",
            "purchase_order",
            instance.pk,
            {"po_number": instance.po_number},
        )
        instance.delete()


class GoodsReceiptListCreateAPIView(generics.ListCreateAPIView):
    serializer_class = GoodsReceiptNoteSerializer
    queryset = GoodsReceiptNote.objects.select_related(
        "purchase_order",
        "purchase_order__vendor",
    ).prefetch_related("items")

    def get_queryset(self):
        queryset = super().get_queryset()
        po_id = self.request.query_params.get("purchase_order")
        if po_id:
            queryset = queryset.filter(purchase_order_id=po_id)
        return queryset

    @transaction.atomic
    def perform_create(self, serializer):
        receipt = serializer.save()
        _refresh_purchase_order_status(receipt.purchase_order)
        InvoiceMatchingResult.objects.filter(
            purchase_order=receipt.purchase_order,
            is_current=True,
        ).update(is_current=False)
        record_audit_event(
            self.request,
            "goods_receipt.created",
            "goods_receipt",
            receipt.pk,
            {
                "grn_number": receipt.grn_number,
                "purchase_order_id": receipt.purchase_order_id,
            },
        )


class GoodsReceiptDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = GoodsReceiptNoteSerializer
    queryset = GoodsReceiptNote.objects.select_related(
        "purchase_order",
        "purchase_order__vendor",
    ).prefetch_related("items")

    @transaction.atomic
    def perform_update(self, serializer):
        old_purchase_order = self.get_object().purchase_order
        receipt = serializer.save()
        _refresh_purchase_order_status(old_purchase_order)
        if receipt.purchase_order_id != old_purchase_order.id:
            _refresh_purchase_order_status(receipt.purchase_order)
        InvoiceMatchingResult.objects.filter(
            purchase_order=old_purchase_order,
            is_current=True,
        ).update(is_current=False)
        InvoiceMatchingResult.objects.filter(
            purchase_order=receipt.purchase_order,
            is_current=True,
        ).update(is_current=False)
        record_audit_event(
            self.request,
            "goods_receipt.updated",
            "goods_receipt",
            receipt.pk,
            {"fields": sorted(serializer.validated_data.keys())},
        )

    @transaction.atomic
    def perform_destroy(self, instance):
        po = instance.purchase_order
        instance.delete()
        _refresh_purchase_order_status(po)
        InvoiceMatchingResult.objects.filter(
            purchase_order=po,
            is_current=True,
        ).update(is_current=False)
        record_audit_event(
            self.request,
            "goods_receipt.deleted",
            "goods_receipt",
            instance.pk,
            {"purchase_order_id": po.pk},
        )


class MatchRequestSerializer(serializers.Serializer):
    purchase_order_id = serializers.IntegerField(required=False)
    goods_receipt_id = serializers.IntegerField(required=False)
    amount_tolerance = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        required=False,
        default=Decimal("0.00"),
    )

    def validate_amount_tolerance(self, value):
        if value < 0:
            raise serializers.ValidationError("Tolerance cannot be negative.")
        return value

    def validate(self, attrs):
        po_id = attrs.get("purchase_order_id")
        grn_id = attrs.get("goods_receipt_id")
        if grn_id:
            receipt = get_object_or_404(GoodsReceiptNote, pk=grn_id)
            if po_id and receipt.purchase_order_id != po_id:
                raise serializers.ValidationError({
                    "goods_receipt_id": "The GRN must belong to the selected purchase order."
                })
            attrs["_goods_receipt"] = receipt
        if po_id:
            attrs["_purchase_order"] = get_object_or_404(PurchaseOrder, pk=po_id)
        elif grn_id:
            attrs["_purchase_order"] = receipt.purchase_order
        return attrs


class InvoiceMatchingAPIView(APIView):
    def get(self, request, pk):
        invoice = get_object_or_404(Invoice, pk=pk)
        result = invoice.matching_results.filter(is_current=True).first()
        if result is None:
            return Response({"detail": "No current matching result exists."}, status=status.HTTP_404_NOT_FOUND)
        return Response(InvoiceMatchingResultSerializer(result).data)

    @transaction.atomic
    def post(self, request, pk):
        invoice = get_object_or_404(Invoice.objects.select_for_update(), pk=pk)
        serializer = MatchRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        result = match_invoice(
            invoice,
            purchase_order=data.get("_purchase_order"),
            goods_receipt=data.get("_goods_receipt"),
            tolerance=data["amount_tolerance"],
        )
        record_audit_event(
            request,
            "invoice.match_performed",
            "invoice",
            invoice.pk,
            {
                "matching_result_id": result.pk,
                "status": result.status,
                "exception_count": len(result.exceptions),
            },
        )
        return Response(
            InvoiceMatchingResultSerializer(result).data,
            status=status.HTTP_201_CREATED,
        )
