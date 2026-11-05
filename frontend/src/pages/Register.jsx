import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import authService from "../services/authService";

const Register = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    confirm_password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (event) => {
    setForm((previous) => ({
      ...previous,
      [event.target.name]: event.target.value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    if (form.password !== form.confirm_password) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setLoading(true);
      await authService.register({
        ...form,
        full_name: form.full_name.trim(),
        email: form.email.trim(),
      });
      navigate("/login", {
        replace: true,
        state: { registrationSuccess: "Account created. Sign in to continue." },
      });
    } catch (registrationError) {
      const data = registrationError.response?.data;
      const message =
        data && typeof data === "object"
          ? Object.values(data)
              .flatMap((value) => (Array.isArray(value) ? value : [value]))
              .join(" ")
          : "";
      setError(message || "Unable to create your account. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-8 shadow-xl"
      >
        <h1 className="text-2xl font-bold text-white">Create your account</h1>
        <p className="mt-2 text-sm text-slate-400">
          Register to access AP Automation.
        </p>
        <label className="mt-6 block text-sm font-medium text-slate-300">
          Full name
          <input
            required
            name="full_name"
            autoComplete="name"
            value={form.full_name}
            onChange={handleChange}
            maxLength={255}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-teal-500"
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-300">
          Email
          <input
            required
            type="email"
            name="email"
            autoComplete="email"
            value={form.email}
            onChange={handleChange}
            maxLength={254}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-teal-500"
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-300">
          Password
          <input
            required
            type="password"
            name="password"
            autoComplete="new-password"
            value={form.password}
            onChange={handleChange}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-teal-500"
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-300">
          Confirm password
          <input
            required
            type="password"
            name="confirm_password"
            autoComplete="new-password"
            value={form.confirm_password}
            onChange={handleChange}
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
          {loading ? "Creating account..." : "Create account"}
        </button>
        <p className="mt-5 text-center text-sm text-slate-400">
          Already registered?{" "}
          <Link to="/login" className="font-semibold text-teal-400 hover:text-teal-300">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
};

export default Register;
