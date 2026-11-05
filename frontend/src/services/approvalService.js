import api from "./api";

const approvalService = {
  approveInvoice: async (id, remarks = "") => {
    const response = await api.post(`/invoices/${id}/approve/`, {
      remarks,
    });

    return response.data;
  },

  rejectInvoice: async (id, remarks = "") => {
    const response = await api.post(`/invoices/${id}/reject/`, {
      remarks,
    });

    return response.data;
  },
};

export default approvalService;