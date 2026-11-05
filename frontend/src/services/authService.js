import api from "./api";

const authService = {
  register: async (registration) => {
    const response = await api.post("/auth/register/", registration);
    return response.data;
  },

  login: async (credentials) => {
    const response = await api.post("/auth/token/", credentials);
    return response.data;
  },

  getCurrentUser: async () => {
    const response = await api.get("/auth/me/");
    return response.data;
  },

  logout: async () => {
    await api.post("/auth/logout/");
  },
};

export default authService;
