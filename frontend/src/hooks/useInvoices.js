
import { useCallback, useEffect, useState } from "react";
import invoiceService from "../services/invoiceService";

const useInvoices = () => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchInvoices = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await invoiceService.getInvoices();

      // Supports both array and paginated API responses
      const invoiceList = Array.isArray(data)
        ? data
        : data.results || [];

      setInvoices(invoiceList);
    } catch (err) {
      console.error("Invoice fetching failed:", err);

      setError(
        err.response?.data?.detail ||
        err.message ||
        "Unable to fetch invoices."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const removeInvoice = useCallback((invoiceId) => {
    setInvoices((currentInvoices) =>
      currentInvoices.filter((invoice) => invoice.id !== invoiceId),
    );
  }, []);
  
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchInvoices();
  }, [fetchInvoices]);

  return {
    invoices,
    loading,
    error,
    refreshInvoices: fetchInvoices,
    removeInvoice,
  };
};

export default useInvoices;
