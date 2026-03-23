export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="text-6xl font-bold" style={{ color: "var(--card-border)" }}>404</div>
        <h2 className="text-xl font-bold" style={{ color: "var(--foreground)" }}>
          页面不存在 / Page Not Found
        </h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          请检查地址是否正确 / Please check the URL
        </p>
        <a
          href="/"
          className="inline-block px-4 py-2 rounded-md text-sm font-medium mt-2"
          style={{ background: "var(--foreground)", color: "var(--background)" }}
        >
          返回首页 / Home
        </a>
      </div>
    </div>
  );
}
