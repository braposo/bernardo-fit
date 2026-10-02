import * as React from "react";
import { Tooltip as Primitive } from "radix-ui";
import { cn } from "cn";

function TooltipProvider({ delayDuration = 200, ...props }) {
  return <Primitive.Provider delayDuration={delayDuration} {...props} />;
}
function Tooltip(props) { return <Primitive.Root {...props} />; }
function TooltipTrigger(props) { return <Primitive.Trigger data-slot="tooltip-trigger" {...props} />; }
function TooltipContent({ className, sideOffset = 4, ...props }) {
  return <Primitive.Portal><Primitive.Content data-slot="tooltip-content" sideOffset={sideOffset}
    className={cn("z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md", className)} {...props} /></Primitive.Portal>;
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
