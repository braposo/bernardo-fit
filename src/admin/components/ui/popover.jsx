import * as React from "react";
import { Popover as Primitive } from "radix-ui";
import { cn } from "cn";
function Popover(props) { return <Primitive.Root data-slot="popover" {...props} />; }
function PopoverTrigger(props) { return <Primitive.Trigger data-slot="popover-trigger" {...props} />; }
function PopoverContent({ className, align = "center", sideOffset = 4, ...props }) {
  return <Primitive.Portal><Primitive.Content data-slot="popover-content" align={align} sideOffset={sideOffset} className={cn("z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none", className)} {...props} /></Primitive.Portal>;
}
export { Popover, PopoverTrigger, PopoverContent };
