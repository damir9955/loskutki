'use client';

/**
 * Диалог подтверждения В СТИЛЕ ИГРЫ — вместо нативного window.confirm.
 * Нативный confirm браузера («Подтвердите действие на сайте») мгновенно
 * выдаёт веб-приложение — игра должна выглядеть как нативное приложение,
 * поэтому все подтверждения рисуем сами, в стилистике «Лоскутков».
 */

import { AlertTriangle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  /** текст кнопки подтверждения (по умолчанию «Да») */
  confirmText?: string;
  /** текст кнопки отмены (по умолчанию «Отмена») */
  cancelText?: string;
  /** опасное действие (выход из партии, удаление) — красная кнопка */
  destructive?: boolean;
  /** иконка «удаление» вместо предупреждения */
  trash?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  destructive = true,
  trash = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#2B2118]/70 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
    >
      <div
        className="pop-in stitched-card w-full max-w-[min(88vw,360px)] p-5 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${
            destructive ? 'bg-[#C33A2F]/12' : 'bg-primary/12'
          }`}
        >
          {trash ? (
            <Trash2 className="h-6 w-6 text-[#C33A2F]" />
          ) : (
            <AlertTriangle className={`h-6 w-6 ${destructive ? 'text-[#C33A2F]' : 'text-primary'}`} />
          )}
        </div>
        <div className="mt-3 text-[18px] font-extrabold leading-snug text-foreground">{title}</div>
        {description && (
          <div className="mt-1.5 text-[13.5px] font-semibold text-muted-foreground">{description}</div>
        )}
        <div className="mt-5 flex gap-2.5">
          <Button
            size="lg"
            className="btn-cloth h-12 flex-1 rounded-2xl text-[15px] font-extrabold"
            onClick={onCancel}
          >
            {cancelText}
          </Button>
          <Button
            size="lg"
            className={`h-12 flex-1 rounded-2xl text-[15px] font-extrabold ${
              destructive
                ? 'border border-[#8f2a20] bg-[#C33A2F] text-white'
                : 'btn-wood'
            }`}
            onClick={onConfirm}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
