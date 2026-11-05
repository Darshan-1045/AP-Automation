from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q
from django.utils import timezone

from invoices.models import (
    ApprovalRule,
    AuditEvent,
    Invoice,
    InvoiceApprovalHistory,
)


class Command(BaseCommand):
    help = "Send pending-approval reminders and escalate overdue invoices."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report notifications that would be sent without changing data.",
        )

    def handle(self, *args, **options):
        reminder_hours = int(getattr(settings, "AP_APPROVAL_REMINDER_HOURS", 24))
        escalation_hours = int(getattr(settings, "AP_APPROVAL_ESCALATION_HOURS", 72))
        escalation_role = getattr(settings, "AP_APPROVAL_ESCALATION_ROLE", "AP Manager")
        if reminder_hours <= 0 or escalation_hours <= reminder_hours:
            raise CommandError(
                "Approval escalation hours must be greater than positive reminder hours."
            )

        now = timezone.now()
        reminded = 0
        escalated = 0
        skipped = 0
        invoices = Invoice.objects.filter(
            status__in=[
                Invoice.Status.PENDING_APPROVAL,
                Invoice.Status.ESCALATED,
            ],
        ).order_by("updated_at", "id")

        for invoice in invoices:
            age = now - invoice.updated_at
            is_escalation = (
                invoice.status != Invoice.Status.ESCALATED
                and age >= timedelta(hours=escalation_hours)
            )
            latest_reminder = AuditEvent.objects.filter(
                action="invoice.approval_reminder_sent",
                entity_type="invoice",
                entity_id=str(invoice.pk),
            ).order_by("-created_at").values_list("created_at", flat=True).first()
            reminder_due = (
                latest_reminder is None
                and age >= timedelta(hours=reminder_hours)
            ) or (
                latest_reminder is not None
                and now - latest_reminder >= timedelta(hours=reminder_hours)
            )
            if not is_escalation and not reminder_due:
                continue

            recipient_role = (
                escalation_role if is_escalation else self._next_approval_role(invoice)
            )
            recipients = list(
                get_user_model().objects.filter(
                    is_active=True,
                    groups__name=recipient_role,
                ).exclude(email="").values_list("email", flat=True).distinct()
            )
            if not recipients:
                skipped += 1
                self.stderr.write(
                    f"Invoice {invoice.pk}: no active email recipients for "
                    f"approval role '{recipient_role}'."
                )
                continue

            action = "escalation" if is_escalation else "reminder"
            if options["dry_run"]:
                self.stdout.write(
                    f"Would send {action} for invoice {invoice.pk} to "
                    f"{len(recipients)} recipient(s)."
                )
                continue

            sent = send_mail(
                subject=f"AP approval {action}: {invoice.invoice_number or invoice.pk}",
                message=(
                    f"Invoice {invoice.invoice_number or invoice.pk} for "
                    f"{invoice.vendor_name or 'Unknown vendor'} is awaiting "
                    f"approval. Current status: {invoice.status}."
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=recipients,
                fail_silently=False,
            )
            if sent != 1:
                raise CommandError(
                    f"Email backend did not confirm delivery of the approval "
                    f"{action} for invoice {invoice.pk}."
                )

            if is_escalation:
                invoice.status = Invoice.Status.ESCALATED
                invoice.save(update_fields=["status", "updated_at"])
                InvoiceApprovalHistory.objects.create(
                    invoice=invoice,
                    action=InvoiceApprovalHistory.Action.ESCALATED,
                    remarks=f"Automatically escalated to {recipient_role}.",
                    actor_username="system",
                    approval_level=invoice.approval_level,
                )
                AuditEvent.objects.create(
                    actor="system",
                    action="invoice.escalated",
                    entity_type="invoice",
                    entity_id=str(invoice.pk),
                    details={
                        "approval_level": invoice.approval_level,
                        "escalation_role": recipient_role,
                        "recipient_count": sent,
                    },
                )
                escalated += 1
            else:
                AuditEvent.objects.create(
                    actor="system",
                    action="invoice.approval_reminder_sent",
                    entity_type="invoice",
                    entity_id=str(invoice.pk),
                    details={
                        "approval_level": invoice.approval_level,
                        "recipient_role": recipient_role,
                        "recipient_count": sent,
                    },
                )
                reminded += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Approval notifications: {reminded} reminder(s), "
                f"{escalated} escalation(s), {skipped} skipped."
            )
        )

    @staticmethod
    def _next_approval_role(invoice):
        amount = invoice.total_amount or 0
        rules = ApprovalRule.objects.filter(
            is_active=True,
            minimum_amount__lte=amount,
        ).filter(
            Q(maximum_amount__isnull=True) | Q(maximum_amount__gte=amount)
        ).order_by("approval_level")
        rule = rules.filter(
            approval_level__gt=invoice.approval_level
        ).first()
        return rule.role if rule else "Approver"
