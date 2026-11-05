
import api from "./api";

const paymentService = {
  getPayments: async () => {
    const response = await api.get("/invoices/payments/");
    return response.data;
  },

  requestPayment: async (paymentData) => {
    const response = await api.post("/invoices/payments/", paymentData);
    return response.data;
  },

  updatePaymentStatus: async (id, paymentData) => {
    const response = await api.post(
      `/invoices/payments/${id}/status/`,
      paymentData
    );
    return response.data;
  },

  getPaymentAdvice: async (id) => {
    const response = await api.get(`/invoices/payments/${id}/advice/`);
    return response.data;
  },

  markInvoicePaid: async (id, paymentData) => {
    const response = await api.post(
      `/invoices/${id}/pay/`,
      paymentData
    );

    return response.data;
  },
};

export default paymentService;
