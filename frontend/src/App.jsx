
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";

import MainLayout from "./components/layout/MainLayout";

import Dashboard from "./pages/Dashboard";
import Reports from "./pages/Reports";
import Invoices from "./pages/Invoices";
import InvoiceDetails from "./pages/InvoiceDetails";
import Approvals from "./pages/Approvals";
import UploadInvoice from "./pages/UploadInvoice";
import Payments from "./pages/Payments";
import Vendors from "./pages/Vendors";
import PurchaseOrders from "./pages/PurchaseOrders";
import GoodsReceipts from "./pages/GoodsReceipts";
import InvoiceMatching from "./pages/InvoiceMatching";
import Login from "./pages/Login";
import Register from "./pages/Register";
import AuthProvider from "./auth/AuthProvider";

function App() {
  const hasToken = Boolean(window.localStorage.getItem("ap-auth-token"));
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes hasToken={hasToken} />
      </AuthProvider>
    </BrowserRouter>
  );
}

function AppRoutes({ hasToken }) {
  const location = useLocation();
  const signInRoute = (
    <Navigate
      to="/login"
      replace
      state={{ from: location }}
    />
  );
  return (
    <Routes>
        <Route path="/login" element={hasToken ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/register" element={hasToken ? <Navigate to="/" replace /> : <Register />} />
        <Route element={hasToken ? <MainLayout /> : signInRoute}>
          <Route path="/" element={<Dashboard />} />

         <Route path="/invoices" element={<Invoices />} />

          <Route path="/upload" element={<UploadInvoice />} />

          <Route path="/vendors" element={<Vendors />} />
          <Route path="/purchase-orders" element={<PurchaseOrders />} />
          <Route path="/goods-receipts" element={<GoodsReceipts />} />
          <Route path="/matching" element={<InvoiceMatching />} />

          <Route path="/approvals" element={<Approvals />} />

          <Route path="/payments" element={<Payments />} />

          <Route path="/reports" element={<Reports />} />
        </Route>

        <Route
          path="/invoices/:id"
          element={hasToken ? <InvoiceDetails /> : signInRoute}
        />

       

        <Route
          path="*"
          element={
            <div className="flex min-h-screen items-center justify-center">
              <h1 className="text-2xl font-bold text-slate-800">
                404 - Page Not Found
              </h1>
            </div>
          }
        />
    </Routes>
  );
}

export default App;
