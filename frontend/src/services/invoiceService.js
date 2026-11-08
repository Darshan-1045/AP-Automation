
import api from "./api";

const invoiceService = {
  // Fetch all invoices
  getInvoices: async () => {
    const response = await api.get("/invoices/");
    return response.data;
  },

  // Fetch a single invoice
  getInvoiceById: async (id) => {
    const response = await api.get(`/invoices/${id}/`);
    return response.data;
  },

  deleteInvoice: async (id) => {
    const response = await api.delete(`/invoices/${id}/`);
    return response.data;
  },

  getInvoiceDocument: async (id) => {
    const response = await api.get(`/invoices/${id}/document/`, {
      responseType: "blob",
    });
    return response.data;
  },

  // Update invoice fields during manual review
  updateInvoice: async (id, data) => {
    const response = await api.patch(`/invoices/${id}/`, data);
    return response.data;
  },

  // Upload an invoice
  uploadInvoice: async (file) => {
    const formData = new FormData();
    formData.append("document", file);

    const response = await api.post("/invoices/", formData);

    return response.data;
  },

  uploadInvoices: async (files, onUploadProgress) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("documents", file));

    const response = await api.post("/invoices/bulk/", formData, {
      timeout: 180000,
      onUploadProgress,
    });
    return response.data;
  },
};

export default invoiceService;
