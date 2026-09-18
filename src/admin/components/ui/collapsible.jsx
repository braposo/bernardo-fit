import * as React from "react";
import { Collapsible as Primitive } from "radix-ui";
function Collapsible(props) { return <Primitive.Root data-slot="collapsible" {...props} />; }
function CollapsibleTrigger(props) { return <Primitive.Trigger data-slot="collapsible-trigger" {...props} />; }
function CollapsibleContent(props) { return <Primitive.Content data-slot="collapsible-content" {...props} />; }
export { Collapsible, CollapsibleTrigger, CollapsibleContent };
