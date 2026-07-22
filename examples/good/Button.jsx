// Uses semantic token classes only — no hardcoded colors.
export const Button = ({ children }) => (
  <button className="text-primary bg-surface border border-primary rounded-lg px-4 py-2">
    {children}
  </button>
);
