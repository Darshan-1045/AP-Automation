
import { Menu, Search, Bell, ChevronDown, LogOut } from "lucide-react";
import authService from "../../services/authService";
import useAuth from "../../hooks/useAuth";

function Header({ onMenuClick }) {
  const { user } = useAuth();

  const signOut = async () => {
    try {
      await authService.logout();
    } catch (error) {
      console.error("Server logout failed:", error);
    } finally {
    window.localStorage.removeItem("ap-auth-token");
    window.location.assign("/login");
    }
  };
  const displayName = user?.full_name || user?.email || "Signed-in user";
  return (
    <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-8">
      {/* Left section */}
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu size={22} />
        </button>

        <div className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 sm:flex sm:w-72">
          <Search size={18} className="text-slate-400" />

          <input
            type="text"
            placeholder="Search invoices, vendors..."
            className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-3 sm:gap-5">
        <button
          className="relative rounded-xl p-2.5 text-slate-500 hover:bg-slate-100"
          aria-label="Notifications"
        >
          <Bell size={21} />

          <span className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-white bg-rose-500" />
        </button>

        <div className="h-8 w-px bg-slate-200" />

        <div className="flex items-center gap-2 rounded-xl p-1.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">
            {displayName.slice(0, 2).toUpperCase()}
          </div>

          <div className="hidden text-left sm:block">
            <p className="text-sm font-semibold text-slate-800">
              {displayName}
            </p>
            <p className="text-xs text-slate-500">
              {user?.email || "AP Automation"}
            </p>
          </div>

          <ChevronDown
            size={16}
            className="hidden text-slate-400 sm:block"
          />
        </div>
        <button
          type="button"
          onClick={signOut}
          aria-label="Sign out"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}

export default Header;
