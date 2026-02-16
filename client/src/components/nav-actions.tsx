import { Heart, Github, Twitter, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

const links = [
  {
    href: "https://ko-fi.com/vibecodingforgood",
    icon: Heart,
    label: "Support on Ko-fi",
    testId: "link-kofi",
    iconClass: "text-rose-500",
  },
  {
    href: "https://github.com/sponsors/Donnadieu",
    icon: Heart,
    label: "Sponsor on GitHub",
    testId: "link-github-sponsors",
    iconClass: "text-rose-500",
  },
  {
    href: "https://x.com/OverviewEffect6",
    icon: Twitter,
    label: "Follow on X",
    testId: "link-twitter",
  },
  {
    href: "https://www.youtube.com/@vibecodingforgood",
    icon: Youtube,
    label: "YouTube",
    testId: "link-youtube",
  },
  {
    href: "https://github.com/Donnadieu",
    icon: Github,
    label: "GitHub",
    testId: "link-github",
  },
] as const;

export function NavActions() {
  return (
    <div className="flex items-center">
      {links.map((link) => (
        <Tooltip key={link.testId}>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              asChild
            >
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={link.testId}
              >
                <link.icon className={`h-4 w-4 ${"iconClass" in link ? link.iconClass : ""}`} />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{link.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
