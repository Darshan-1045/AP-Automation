import api from "./api";

const procurementService = {
  getPurchaseOrders: async (params = {}) => {
    const response = await api.get("/invoices/purchase-orders/", { params });
    return response.data;
  },
  createPurchaseOrder: async (data) => {
    const response = await api.post("/invoices/purchase-orders/", data);
    return response.data;
  },
  updatePurchaseOrder: async (id, data) => {
    const response = await api.patch(`/invoices/purchase-orders/${id}/`, data);
    return response.data;
  },
  deletePurchaseOrder: async (id) => {
    const response = await api.delete(`/invoices/purchase-orders/${id}/`);
    return response.data;
  },
  getGoodsReceipts: async () => {
    const response = await api.get("/invoices/goods-receipts/");
    return response.data;
  },
  createGoodsReceipt: async (data) => {
    const response = await api.post("/invoices/goods-receipts/", data);
    return response.data;
  },
  getMatchingResult: async (invoiceId) => {
    const response = await api.get(`/invoices/${invoiceId}/match/`);
    return response.data;
  },
  matchInvoice: async (invoiceId, data) => {
    const response = await api.post(`/invoices/${invoiceId}/match/`, data);
    return response.data;
  },
};

export default procurementService;
