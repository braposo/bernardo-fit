"use client"

import * as React from "react"
import { cn } from "cn"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

function Sheet(props) {
  return <DialogPrimitive.Root data-slot="sheet" modal={false} {...props} />
}

function SheetTrigger(props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetContent({ className, children, ...props }) {
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Content
      data-slot="sheet-content"
      className={cn("fixed inset-y-0 right-0 z-50 flex h-dvh flex-col border-l bg-background shadow-lg outline-none", className)}
      onInteractOutside={event => event.preventDefault()}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        data-slot="sheet-close"
        className="absolute top-4 right-4 flex size-11 items-center justify-center rounded-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <XIcon aria-hidden="true" />
        <span className="sr-only">Close chat</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
}

function SheetTitle(props) {
  return <DialogPrimitive.Title data-slot="sheet-title" {...props} />
}

function SheetDescription(props) {
  return <DialogPrimitive.Description data-slot="sheet-description" {...props} />
}

export { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription }
