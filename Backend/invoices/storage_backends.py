import mimetypes
import posixpath
from pathlib import PurePosixPath

import httpx
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured, SuspiciousFileOperation
from django.core.files.base import ContentFile
from django.core.files.storage import Storage
from django.core.files.utils import validate_file_name
from django.urls import reverse
from storage3.exceptions import StorageApiError
from storage3.utils import StorageException
from supabase import create_client


class SupabaseStorageError(Exception):
    """Raised when an invoice document operation fails in Supabase Storage."""


class SupabaseInvoiceStorage(Storage):
    def __init__(self):
        self.supabase_url = settings.SUPABASE_URL
        self.service_role_key = settings.SUPABASE_SERVICE_ROLE_KEY
        self.bucket_name = settings.SUPABASE_STORAGE_BUCKET

        if not self.supabase_url or not self.service_role_key or not self.bucket_name:
            raise ImproperlyConfigured(
                "Supabase invoice storage is not fully configured."
            )

        self.client = create_client(self.supabase_url, self.service_role_key)

    def _bucket(self):
        return self.client.storage.from_(self.bucket_name)

    @staticmethod
    def _normalize_name(name):
        normalized = str(name).replace("\\", "/")
        validate_file_name(normalized, allow_relative_path=True)

        path = PurePosixPath(normalized)
        if path.is_absolute() or any(part in {".", ".."} for part in path.parts):
            raise SuspiciousFileOperation("Invalid invoice document name.")

        normalized = posixpath.normpath(normalized)
        if normalized in {"", "."}:
            raise SuspiciousFileOperation("Invalid invoice document name.")
        return normalized

    @staticmethod
    def _read_content(content):
        if hasattr(content, "seek"):
            content.seek(0)
        if hasattr(content, "chunks"):
            data = b"".join(content.chunks())
        else:
            data = content.read()
        if hasattr(content, "seek"):
            content.seek(0)
        return data

    @staticmethod
    def _raise_storage_error(action, exc):
        raise SupabaseStorageError(
            f"Supabase Storage could not {action} the invoice document."
        ) from exc

   
    def _info(self, name):
        name = self._normalize_name(name)

        try:
            return self._bucket().info(name)

        except StorageApiError as exc:
            # Supabase Storage may return HTTP 400 while its
            # error payload indicates that the object is not found.
            error_data = (
                exc.args[0]
                if exc.args and isinstance(exc.args[0], dict)
                else {}
            )

            status_code = (
                error_data.get("statusCode")
                or error_data.get("status")
                or getattr(exc, "status", None)
            )

            error_type = str(error_data.get("error", "")).lower()
            message = str(error_data.get("message", "")).lower()

            if (
                str(status_code) == "404"
                or error_type == "not_found"
                or "object not found" in message
            ):
                return None

            self._raise_storage_error("read metadata for", exc)

        except (StorageException, httpx.HTTPError) as exc:
            self._raise_storage_error("read metadata for", exc)


    def _save(self, name, content):
        name = self._normalize_name(name)
        payload = self._read_content(content)
        content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        candidate = name

        for attempt in range(3):
            try:
                self._bucket().upload(
                    candidate,
                    payload,
                    file_options={
                        "content-type": content_type,
                        "upsert": "false",
                    },
                )
                return candidate
            except StorageApiError as exc:
                if getattr(exc, "status", None) == 409 and attempt < 2:
                    directory, filename = posixpath.split(candidate)
                    file_root, file_ext = posixpath.splitext(filename)
                    candidate = posixpath.join(
                        directory,
                        self.get_alternative_name(file_root, file_ext),
                    )
                    candidate = self.get_available_name(
                        candidate,
                        max_length=100,
                    )
                    continue
                self._raise_storage_error("upload", exc)
            except (StorageException, httpx.HTTPError) as exc:
                self._raise_storage_error("upload", exc)

        raise SupabaseStorageError("Supabase Storage could not upload the invoice document.")

    def _open(self, name, mode="rb"):
        if mode not in {"r", "rb"}:
            raise ValueError("Invoice documents can only be opened for reading.")

        name = self._normalize_name(name)
        try:
            content = self._bucket().download(name)
        except StorageApiError as exc:
            if getattr(exc, "status", None) == 404:
                raise FileNotFoundError("Invoice document was not found.") from exc
            self._raise_storage_error("download", exc)
        except (StorageException, httpx.HTTPError) as exc:
            self._raise_storage_error("download", exc)

        if not isinstance(content, bytes):
            raise SupabaseStorageError(
                "Supabase Storage returned an invalid invoice document."
            )
        return ContentFile(content, name=name)

    def delete(self, name):
        name = self._normalize_name(name)
        try:
            self._bucket().remove([name])
        except (StorageException, httpx.HTTPError) as exc:
            self._raise_storage_error("delete", exc)

    def exists(self, name):
        return self._info(name) is not None

    def size(self, name):
        info = self._info(name)
        if info is None:
            raise FileNotFoundError("Invoice document was not found.")

        if isinstance(info, list):
            info = info[0] if info else {}
        metadata = info.get("metadata", {}) if isinstance(info, dict) else {}
        size = metadata.get("size", (
            info.get("size") if isinstance(info, dict) else None
        ))
        if size is None:
            raise SupabaseStorageError(
                "Supabase Storage did not return invoice document size metadata."
            )
        try:
            return int(size)
        except (TypeError, ValueError) as exc:
            raise SupabaseStorageError(
                "Supabase Storage returned invalid invoice document size metadata."
            ) from exc

    def url(self, name):
        name = self._normalize_name(name)
        from .models import Invoice

        invoice_id = (
            Invoice.objects.filter(document=name)
            .order_by("pk")
            .values_list("pk", flat=True)
            .first()
        )
        if invoice_id is None:
            raise ValueError(
                "Invoice documents are only available through the authenticated API."
            )
        return reverse("invoice-document", args=[invoice_id])
