from .models import AuditEvent


def record_audit_event(request, action, entity_type, entity_id, details=None):
    user = getattr(request, "user", None) if request is not None else None
    actor = (
        user.get_username()
        if user is not None and user.is_authenticated
        else "anonymous" if request is not None else "system"
    )
    return AuditEvent.objects.create(
        actor=actor[:150],
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id)[:64],
        details=details or {},
    )
