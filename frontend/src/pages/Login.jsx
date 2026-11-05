import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import authService from "../services/authService";

function Login() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await authService.login({ email: email.trim(), password });
      window.localStorage.setItem("ap-auth-token", data.token);
      const requestedPath = location.state?.from
        ? `${location.state.from.pathname}${location.state.from.search || ""}${location.state.from.hash || ""}`
        : searchParams.get("next") || "/";
      window.location.assign(
        requestedPath.startsWith("/") && !requestedPath.startsWith("//")
          ? requestedPath
          : "/"
      );
    } catch (loginError) {
      const message =
        loginError.response?.data?.detail ||
        loginError.response?.data?.non_field_errors?.[0];
      setError(message || "Unable to sign in. Check your username and password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-8 shadow-xl"
      >
        <h1 className="text-2xl font-bold text-white">AP Automation</h1>
        <p className="mt-2 text-sm text-slate-400">
          Sign in to your account.
        </p>
        {location.state?.registrationSuccess && (
          <p role="status" className="mt-4 rounded-lg bg-emerald-950 p-3 text-sm text-emerald-300">
            {location.state.registrationSuccess}
          </p>
        )}
        <label className="mt-6 block text-sm font-medium text-slate-300">
          Email
          <input
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-teal-500"
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-300">
          Password
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-teal-500"
          />
        </label>
        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-950 p-3 text-sm text-red-300">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-lg bg-teal-600 px-4 py-2.5 font-semibold text-white hover:bg-teal-500 disabled:opacity-60"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
        <p className="mt-5 text-center text-sm text-slate-400">
          New to AP Automation?{" "}
          <Link to="/register" className="font-semibold text-teal-400 hover:text-teal-300">
            Create an account
          </Link>
        </p>
      </form>
    </main>
  );
}

export default Login;
