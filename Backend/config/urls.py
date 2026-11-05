from django.contrib import admin
from django.urls import include, path
from invoices.auth_views import (
    CurrentUserAPIView,
    EmailTokenAuthView,
    LogoutAPIView,
    RegistrationAPIView,
)
from invoices.dashboard_views import DashboardAPIView
from invoices.report_views import ReportAPIView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/register/", RegistrationAPIView.as_view(), name="api-register"),
    path("api/auth/token/", EmailTokenAuthView.as_view(), name="api-token-auth"),
    path("api/auth/me/", CurrentUserAPIView.as_view(), name="api-current-user"),
    path("api/auth/logout/", LogoutAPIView.as_view(), name="api-logout"),
    path("api/dashboard/", DashboardAPIView.as_view(), name="dashboard"),
    path("api/invoices/", include("invoices.urls")),
    path("api/reports/", ReportAPIView.as_view(), name="reports"),
]