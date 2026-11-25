import type { SVGProps } from 'react';

/**
 * Ícone oficial de moeda/dinheiro (SVG 215×215). Herda a cor do contexto (currentColor) e aceita className, como os ícones lucide que substitui.
 * Decorativo por omissão (aria-hidden); passa aria-label/role para o tornar a única indicação.
 */
export function MoneyIcon(props: SVGProps<SVGSVGElement>) {
  const decorativo = props['aria-label'] === undefined && props.role === undefined;
  return (
    <svg viewBox="0 0 215 215" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden={decorativo ? true : undefined} focusable="false" {...props}>
      <path fill="currentColor" d="M0 107.143C0 47.9688 47.9688 0 107.143 0C166.317 0 214.286 47.9688 214.286 107.143C214.286 166.317 166.317 214.286 107.143 214.286C47.9688 214.286 0 166.317 0 107.143ZM109.701 114.929C122.978 118.196 126.955 122.527 126.955 129.839C126.955 137.438 121.844 143.188 109.701 144.112V114.929ZM101.679 98.5312C90.3214 95.6875 86.058 90.933 86.058 84.4688C86.058 78.0045 91.4554 72.1161 101.683 70.8393L101.679 98.5312ZM109.701 100.446V70.8393C118.79 71.9732 125.179 77.1562 126.103 86.1071H140.871C140.304 69.9911 127.451 59.3393 109.701 57.9152V45.9196H101.679V57.9152C83.7857 59.2679 71.0089 69.7723 71.0089 85.6786C71.0089 100.089 80.7366 108.188 98.7679 112.375L101.679 113.085V144.04C90.25 142.835 84.8527 136.728 83.5759 128.42H68.8795C69.3705 145.46 83.6473 155.612 101.679 156.964V168.888H109.701V156.964C127.808 155.683 142.009 145.817 142.009 128.42C142.009 113.299 131.786 105.629 113.112 101.299L109.701 100.446Z" />
    </svg>
  );
}
