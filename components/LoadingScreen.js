export function LoadingScreen({ label = "Loading" }) {
  return (
    <main className="loading-screen">
      <div className="loading-box">{label}</div>
    </main>
  );
}
