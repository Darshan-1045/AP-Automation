import { useRef, useState } from "react";
import {
  Upload,
  FileText,
  X,
  LoaderCircle,
  AlertCircle,
} from "lucide-react";
import invoiceService from "../../services/invoiceService";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_FILE_COUNT = 20;
const SUPPORTED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "tif", "tiff"];

const validateFile = (file) => {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    return "is not a supported PDF, PNG, JPG, JPEG, TIF or TIFF file.";
  }
  if (file.size > MAX_FILE_SIZE) {
    return "is larger than the 25 MB per-file limit.";
  }
  return "";
};

const getErrorMessage = (error) => {
  const data = error.response?.data;

  if (typeof data === "string") return data;
  if (data?.detail) return data.detail;
  if (data?.error) return data.error;

  if (data && typeof data === "object") {
    return Object.entries(data)
      .map(([field, messages]) => {
        const value = Array.isArray(messages)
          ? messages.join(", ")
          : String(messages);
        return `${field}: ${value}`;
      })
      .join(" | ");
  }

  return error.message || "Unable to upload invoices. Please try again.";
};

const InvoiceUpload = ({ onUploadSuccess }) => {
  const fileInputRef = useRef(null);

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");

  const selectFiles = (fileList) => {
    setError("");

    const incomingFiles = Array.from(fileList || []);
    if (!incomingFiles.length) return;

    const acceptedFiles = [];
    const rejectedFiles = [];

    incomingFiles.forEach((file) => {
      const validationError = validateFile(file);
      if (validationError) {
        rejectedFiles.push(`${file.name} ${validationError}`);
      } else {
        acceptedFiles.push(file);
      }
    });

    const combinedFiles = [...selectedFiles, ...acceptedFiles];
    if (combinedFiles.length > MAX_FILE_COUNT) {
      setError(`You can upload at most ${MAX_FILE_COUNT} files at once.`);
      return;
    }

    setSelectedFiles(combinedFiles);
    if (rejectedFiles.length) {
      setError(`Skipped: ${rejectedFiles.join(" ")}`);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (!uploading) selectFiles(event.dataTransfer.files);
  };

  const handleUpload = async () => {
    if (!selectedFiles.length || uploading) return;

    try {
      setUploading(true);
      setUploadProgress(0);
      setError("");

      const response = await invoiceService.uploadInvoices(
        selectedFiles,
        (event) => {
          if (event.total) {
            setUploadProgress(Math.round((event.loaded * 100) / event.total));
          }
        },
      );
      setSelectedFiles([]);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      onUploadSuccess(response.results);
    } catch (err) {
      console.error("Invoice upload failed:", err);
      setError(getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const removeFile = (indexToRemove) => {
    setSelectedFiles((files) =>
      files.filter((_, index) => index !== indexToRemove),
    );
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-slate-900">
          Upload Invoice Documents
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Upload up to 20 invoices for automatic OCR and AI processing. Each
          file can be up to 25 MB.
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff"
        multiple
        onChange={(event) => selectFiles(event.target.files)}
        className="hidden"
      />

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDrop={handleDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`flex min-h-[230px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition ${
          dragging
            ? "border-blue-500 bg-blue-50"
            : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/50"
        } ${uploading ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100">
          <Upload size={26} className="text-blue-600" />
        </div>

        <p className="font-semibold text-slate-800">
          Drag and drop invoice files here
        </p>

        <p className="mt-2 text-sm text-slate-500">
          or click to browse multiple files
        </p>

        <p className="mt-3 text-xs text-slate-400">
          Supported formats: PDF, PNG, JPG, JPEG, TIF and TIFF
        </p>
      </div>

      {selectedFiles.length > 0 && (
        <ul className="mt-5 space-y-2">
          {selectedFiles.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="shrink-0 text-blue-600" size={22} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {file.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={uploading}
                onClick={(event) => {
                  event.stopPropagation();
                  removeFile(index);
                }}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                aria-label={`Remove ${file.name}`}
              >
                <X size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={handleUpload}
          disabled={!selectedFiles.length || uploading}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? (
            <>
              <LoaderCircle size={17} className="animate-spin" />
              {uploadProgress < 100
                ? `Uploading ${uploadProgress}%...`
                : `Processing ${selectedFiles.length} invoice(s)...`}
            </>
          ) : (
            <>
              <Upload size={17} />
              Upload and Process
            </>
          )}
        </button>
      </div>

      {uploading && (
        <p className="mt-4 text-center text-xs text-slate-500">
          {uploadProgress < 100
            ? "Uploading documents..."
            : "Upload complete. Each file is being processed independently."}
        </p>
      )}
    </div>
  );
};

export default InvoiceUpload;
