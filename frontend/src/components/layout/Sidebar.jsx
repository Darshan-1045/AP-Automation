
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  Upload,
  Users,
  ClipboardCheck,
  Wallet,
  ChartNoAxesCombined,
  Receipt,
  X,
  ClipboardList,
  PackageCheck,
  GitCompareArrows,
} from "lucide-react";

const navigation = [
  {
    title: "OVERVIEW",
    items: [
      { name: "Dashboard", path: "/", icon: LayoutDashboard },
    ],
  },
  {
    title: "WORKSPACE",
    items: [
      { name: "Invoices", path: "/invoices", icon: FileText },
      { name: "Upload Invoice", path: "/upload", icon: Upload },
      { name: "Vendors", path: "/vendors", icon: Users },
      { name: "Purchase Orders", path: "/purchase-orders", icon: ClipboardList },
      { name: "Goods Receipts", path: "/goods-receipts", icon: PackageCheck },
      { name: "Invoice Matching", path: "/matching", icon: GitCompareArrows },
      { name: "Approvals", path: "/approvals", icon: ClipboardCheck },
      { name: "Payments", path: "/payments", icon: Wallet },
    ],
  },
  {
    title: "ANALYTICS",
    items: [
      { name: "Reports", path: "/reports", icon: ChartNoAxesCombined },
    ],
  },
];

function Sidebar({ isOpen, onClose }) {
  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col
          bg-[#17243b] text-slate-300 transition-transform duration-300
          lg:translate-x-0
          ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Brand */}
        <div className="flex h-20 items-center justify-between border-b border-white/10 px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500">
              <Receipt size={23} className="text-white" />
            </div>

            <div>
              <h1 className="text-lg font-bold text-white">
                AP Control
              </h1>
              <p className="text-xs text-slate-400">
                Invoice Automation
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-white/10 lg:hidden"
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-7 overflow-y-auto px-4 py-7">
          {navigation.map((group) => (
            <div key={group.title}>
              <p className="mb-3 px-3 text-[11px] font-semibold tracking-[1.5px] text-slate-500">
                {group.title}
              </p>

              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;

                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === "/"}
                      onClick={onClose}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all ${
                          isActive
                            ? "bg-teal-500/15 text-teal-300"
                            : "text-slate-400 hover:bg-white/5 hover:text-white"
                        }`
                      }
                    >
                      <Icon size={19} />
                      <span>{item.name}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/10 p-5">
          <div className="rounded-xl bg-white/5 p-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-xs font-medium text-slate-300">
                OCR Processing System
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Accounts Payable Workspace
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
