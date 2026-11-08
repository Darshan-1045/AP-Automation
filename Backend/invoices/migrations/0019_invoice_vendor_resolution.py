# Generated for invoice vendor detection and association.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("invoices", "0018_preserve_vendor_onboarding_history"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="extracted_vendor_details",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="invoice",
            name="vendor",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="invoices",
                to="invoices.vendor",
            ),
        ),
        migrations.AddField(
            model_name="invoice",
            name="vendor_resolution_status",
            field=models.CharField(
                choices=[
                    ("PENDING", "Pending"),
                    ("MATCHED", "Matched"),
                    ("NEW_VENDOR", "New vendor"),
                    ("INACTIVE", "Inactive vendor"),
                    ("AMBIGUOUS", "Ambiguous vendor"),
                    ("UNRESOLVED", "Unresolved vendor"),
                ],
                default="PENDING",
                max_length=20,
            ),
        ),
    ]
