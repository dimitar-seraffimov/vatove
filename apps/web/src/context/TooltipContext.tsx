import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
  useState,
} from "react";

interface TooltipContextValue {
  activeSampleIndex: number | null;
  setActiveSampleIndex: (index: number | null) => void;
}

const TooltipContext = createContext<TooltipContextValue | null>(null);

export function TooltipProvider({ children }: PropsWithChildren) {
  const [activeSampleIndex, setActiveSampleIndex] = useState<number | null>(null);
  const value = useMemo(
    () => ({ activeSampleIndex, setActiveSampleIndex }),
    [activeSampleIndex],
  );

  return <TooltipContext.Provider value={value}>{children}</TooltipContext.Provider>;
}

// This module intentionally exports the provider and its paired hook.
// eslint-disable-next-line react-refresh/only-export-components
export function useTooltip(): TooltipContextValue {
  const context = useContext(TooltipContext);
  if (!context) throw new Error("useTooltip must be used inside TooltipProvider");
  return context;
}
