import { useRef } from "react";

export default function PrimaryButton({ children, onClick, type = "button", style, disabled = false, className }) {
  const ref = useRef(null);

  function handleClick(event) {
    const button = ref.current;
    if (!button || disabled) return;

    const rect = button.getBoundingClientRect();
    button.style.setProperty("--x", `${((event.clientX - rect.left) / rect.width) * 100}%`);
    button.style.setProperty("--y", `${((event.clientY - rect.top) / rect.height) * 100}%`);
    onClick?.(event);
  }

  const cls = ["primary-button", className].filter(Boolean).join(" ");

  return (
    <button ref={ref} className={cls} type={type} onClick={handleClick} style={style} disabled={disabled}>
      {children}
    </button>
  );
}
