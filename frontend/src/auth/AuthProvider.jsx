import { useCallback, useEffect, useMemo, useState } from "react";
import AuthContext from "./authContext";
import authService from "../services/authService";

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(
    Boolean(window.localStorage.getItem("ap-auth-token"))
  );
  const [error, setError] = useState("");

  const refreshUser = useCallback(async () => {
    if (!window.localStorage.getItem("ap-auth-token")) {
      setUser(null);
      setError("");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      setUser(await authService.getCurrentUser());
    } catch (requestError) {
      console.error("Unable to load current user:", requestError);
      setUser(null);
      setError("Unable to load your account. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!window.localStorage.getItem("ap-auth-token")) return undefined;

    let active = true;
    authService.getCurrentUser()
      .then((currentUser) => {
        if (active) setUser(currentUser);
      })
      .catch((requestError) => {
        if (active) {
          console.error("Unable to load current user:", requestError);
          setUser(null);
          setError("Unable to load your account. Please try again.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    error,
    refreshUser,
  }), [error, loading, refreshUser, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthProvider;
