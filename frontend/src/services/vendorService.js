import api from "./api";

const vendorService = {
  // Fetch all vendors
  getVendors: async () => {
    const response = await api.get("/invoices/vendors/");
    return response.data;
  },

  getVendorOptions: async () => {
    const response = await api.get("/invoices/vendors/options/");
    return response.data;
  },

  // Create vendor
  createVendor: async (data) => {
    const response = await api.post("/invoices/vendors/", data);
    return response.data;
  },

  // Update vendor
  updateVendor: async (id, data) => {
    const response = await api.patch(`/invoices/vendors/${id}/`, data);
    return response.data;
  },

  // Delete vendor
  deleteVendor: async (id) => {
    const response = await api.delete(`/invoices/vendors/${id}/`);
    return response.data;
  },
};

export default vendorService;