import * as React from 'react'

import { Combobox as BaseCombobox } from '@base-ui/react'
import { Check, ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

export const Combobox = BaseCombobox.Root

export const ComboboxInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithoutRef<typeof BaseCombobox.Input>
>(({ className, ...props }, ref) => {
  return (
    <div className="relative w-full">
      <BaseCombobox.Input
        ref={ref}
        className={cn(
          'flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 py-2 pr-10 pl-3 text-sm text-white transition-all placeholder:text-white/30 focus:border-violet-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
      <div className="pointer-events-none absolute top-1/2 right-3 shrink-0 -translate-y-1/2 opacity-50">
        <ChevronDown className="h-4 w-4 text-white" />
      </div>
    </div>
  )
})
ComboboxInput.displayName = 'ComboboxInput'

export const ComboboxContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseCombobox.Popup>
>(({ className, children, ...props }, ref) => {
  return (
    <BaseCombobox.Portal>
      <BaseCombobox.Positioner
        side="bottom"
        align="start"
        sideOffset={6}
        className="z-50 w-[var(--anchor-width)] min-w-[200px]"
      >
        <BaseCombobox.Popup
          ref={ref}
          className={cn(
            'max-h-60 animate-in overflow-hidden rounded-xl border border-white/10 bg-[#16161c]/95 shadow-xl backdrop-blur-md duration-100 outline-none fade-in slide-in-from-top-1',
            className,
          )}
          {...props}
        >
          {children}
        </BaseCombobox.Popup>
      </BaseCombobox.Positioner>
    </BaseCombobox.Portal>
  )
})
ComboboxContent.displayName = 'ComboboxContent'

export const ComboboxList = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseCombobox.List>
>(({ className, ...props }, ref) => {
  return (
    <BaseCombobox.List
      ref={ref}
      className={cn(
        'max-h-48 scrollbar-thin scrollbar-thumb-white/10 overflow-y-auto p-1',
        className,
      )}
      {...props}
    />
  )
})
ComboboxList.displayName = 'ComboboxList'

export const ComboboxItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseCombobox.Item>
>(({ className, children, ...props }, ref) => {
  return (
    <BaseCombobox.Item
      ref={ref}
      className={cn(
        'flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-white transition-colors outline-none select-none hover:bg-white/5 data-[highlighted]:bg-white/5',
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      <BaseCombobox.ItemIndicator className="ml-2 shrink-0">
        <Check className="h-3.5 w-3.5 text-violet-400" />
      </BaseCombobox.ItemIndicator>
    </BaseCombobox.Item>
  )
})
ComboboxItem.displayName = 'ComboboxItem'

export const ComboboxEmpty = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseCombobox.Empty>
>(({ className, ...props }, ref) => {
  return (
    <BaseCombobox.Empty
      ref={ref}
      className={cn('py-3 text-center text-xs text-white/40', className)}
      {...props}
    />
  )
})
ComboboxEmpty.displayName = 'ComboboxEmpty'
