
import axios from "axios";

const api = axios.create({
  baseURL:
    import.meta.env.VITE_API_BASE_URL ||
    (import.meta.env.DEV
      ? "http://127.0.0.1:8000/api"
      : "/api"),

  timeout: 30000,

  headers: {
    Accept: "application/json",
  },
});

api.interceptors.request.use((config) => {
  const token = window.localStorage.getItem("ap-auth-token");

  if (token) {
    config.headers.Authorization = `Token ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      !error.config?.url?.includes("/auth/token/") &&
      !error.config?.url?.includes("/auth/register/")
    ) {
      const returnTo =
        window.location.pathname +
        window.location.search +
        window.location.hash;

      window.localStorage.removeItem("ap-auth-token");

      if (window.location.pathname !== "/login") {
        window.location.assign(
          `/login?next=${encodeURIComponent(returnTo)}`
        );
      }
    }

    return Promise.reject(error);
  }
);

export default api;
