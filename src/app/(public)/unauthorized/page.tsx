

import Link from 'next/link';

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-slate-50 via-slate-100 to-slate-200 px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-2xl shadow-slate-200/80">
        <span className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-2 text-sm font-semibold uppercase tracking-wide text-red-700">
          <span aria-hidden>!</span>
          <span>Access Denied</span>
        </span>
        <h1 className="mt-4 text-3xl font-bold text-slate-900">Error 403: Unauthorized</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-600">
          You do not have permission to view this page. If you believe this is an error, try signing in again or reach out to support.
        </p>
        <div className="mt-6 flex justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-white"
          >
            Go back home
          </Link>
        </div>
      </div>
    </div>
  );
}