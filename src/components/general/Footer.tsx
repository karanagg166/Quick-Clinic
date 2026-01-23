"use client";

import Link from "next/link";
import Logo from "@/components/general/Logo";
import { SiGithub, SiLinkedin, SiInstagram, SiX } from "react-icons/si";
import { Mail } from "lucide-react";

// Made by Karan Aggarwal & Harsh Mishra

export default function Footer() {
  const currentYear = new Date().getFullYear();

  const socialLinks = [
    {
      icon: <SiGithub size={20} />,
      href: "https://github.com/karanagg166",
      label: "GitHub",
    },
    {
      icon: <SiLinkedin size={20} color="#0A66C2" />,
      href: "https://www.linkedin.com/in/karan-aggarwal-a13427276/",
      label: "LinkedIn",
    },
    {
      icon: <SiInstagram size={20} color="#E1306C" />,
      href: "https://www.instagram.com/karanagg_166/",
      label: "Instagram",
    },
    {
      icon: <SiX size={20} />,
      href: "https://x.com/Karanaggrawal1",
      label: "X (Twitter)",
    },
  ];

  return (
    <footer className="bg-muted/30 border-t mt-auto">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          {/* Brand Section */}
          <div className="col-span-1 md:col-span-1 space-y-4">
            <Logo />
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your trusted healthcare companion. Connecting doctors and patients seamlessly with modern technology.
            </p>
          </div>

          {/* Quick Links */}
          <div className="space-y-4">
            <h3 className="font-semibold text-foreground">Quick Links</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/" className="hover:text-primary transition-colors">
                  Home
                </Link>
              </li>
              <li>
                <Link href="/about" className="hover:text-primary transition-colors">
                  About Us
                </Link>
              </li>
              <li>
                <Link href="/auth/login" className="hover:text-primary transition-colors">
                  Login
                </Link>
              </li>
              <li>
                <Link href="/auth/signup" className="hover:text-primary transition-colors">
                  Sign Up
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal / Resources */}
          <div className="space-y-4">
            <h3 className="font-semibold text-foreground">Legal</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="#" className="hover:text-primary transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="#" className="hover:text-primary transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="#" className="hover:text-primary transition-colors">
                  Cookie Policy
                </Link>
              </li>
            </ul>
          </div>

          {/* Connect */}
          <div className="space-y-4">
            <h3 className="font-semibold text-foreground">Connect with Author</h3>
            <div className="flex gap-4">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors hover:scale-110 transform duration-200"
                  title={social.label}
                >
                  {social.icon}
                </a>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              <a href="mailto:aggarwalkaran241@gmail.com" className="hover:text-primary flex items-center gap-2">
                <Mail size={16} /> aggarwalkaran241@gmail.com
              </a>
            </p>
          </div>
        </div>

        <div className="border-t pt-4 flex flex-col md:flex-row items-center justify-between text-sm text-muted-foreground">
          <p>© {currentYear} QuickClinic. All rights reserved.</p>
          <p className="mt-2 md:mt-0 font-medium">
            Made with ❤️ by <span className="text-foreground">Karan Aggarwal</span> & <span className="text-foreground">Harsh Mishra</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
