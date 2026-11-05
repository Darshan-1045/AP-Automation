from rest_framework.permissions import BasePermission


ADMIN_ROLE = "Admin"
AP_MANAGER_ROLE = "AP Manager"
APPROVER_ROLE = "Approver"
FINANCE_ROLE = "Finance"


def has_any_role(user, roles):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    return user.groups.filter(name__in=roles).exists()


class IsAdminOrAPManager(BasePermission):
    def has_permission(self, request, view):
        return has_any_role(request.user, {ADMIN_ROLE, AP_MANAGER_ROLE})


class CanApproveInvoices(BasePermission):
    def has_permission(self, request, view):
        return has_any_role(
            request.user,
            {ADMIN_ROLE, AP_MANAGER_ROLE, APPROVER_ROLE},
        )


class CanProcessPayments(BasePermission):
    def has_permission(self, request, view):
        return has_any_role(request.user, {ADMIN_ROLE, FINANCE_ROLE})


class CanRequestPayments(BasePermission):
    def has_permission(self, request, view):
        return has_any_role(
            request.user,
            {ADMIN_ROLE, AP_MANAGER_ROLE, FINANCE_ROLE},
        )


class CanViewVendorBankDetails(BasePermission):
    def has_permission(self, request, view):
        return has_any_role(
            request.user,
            {ADMIN_ROLE, AP_MANAGER_ROLE, FINANCE_ROLE},
        )
