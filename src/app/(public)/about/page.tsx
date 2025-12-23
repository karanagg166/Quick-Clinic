"use client";

import {
  SiNextdotjs,
  SiTypescript,
  SiTailwindcss,
  SiPrisma,
  SiPostgresql,
  SiRedis,
  SiSocketdotio,
  SiNodedotjs,
  SiDocker,
  SiGithub,
  SiLinkedin,
  SiInstagram,
  SiLeetcode,
  SiCodeforces,
} from "react-icons/si";

import { Mail, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background p-6 md:p-10">

      {/* PAGE HEADER */}
      <div className="max-w-4xl mx-auto mb-12">
        <h1 className="text-4xl md:text-5xl font-semibold text-center mb-4 text-foreground">
          About Quick Clinic
        </h1>
        <p className="text-center text-muted-foreground max-w-3xl mx-auto text-base md:text-lg">
          Quick Clinic is a modern healthcare platform built to simplify doctor–patient interactions. 
          From real-time chat to appointment scheduling, we deliver a seamless, secure, and scalable experience using cutting-edge technologies.
        </p>
      </div>

      {/* TECH STACK SECTION */}
      <TechStackSection />

      {/* CONTRIBUTORS SECTION */}
      <ContributorsSection />

    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                TECH SECTION                                 */
/* -------------------------------------------------------------------------- */

function TechStackSection() {
  return (
    <section className="max-w-6xl mx-auto mb-16">
      <h2 className="text-3xl md:text-4xl font-semibold mb-8 text-foreground text-center">
        Technologies Used
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">

        <TechCard icon={<SiNextdotjs size={40} />} name="Next.js" />
        <TechCard icon={<SiTypescript size={40} color="#3178C6" />} name="TypeScript" />
        <TechCard icon={<SiTailwindcss size={40} color="#38BDF8" />} name="Tailwind CSS" />
        <TechCard icon={<SiPrisma size={40} />} name="Prisma ORM" />
        <TechCard icon={<SiPostgresql size={40} color="#336791" />} name="PostgreSQL" />
        <TechCard icon={<SiRedis size={40} color="#DC382D" />} name="Redis" />
        <TechCard icon={<SiSocketdotio size={40} />} name="Socket.IO" />
        <TechCard icon={<SiNodedotjs size={40} color="#3C873A" />} name="Node.js" />
        <TechCard icon={<SiDocker size={40} color="#0db7ed" />} name="Docker" />

      </div>
    </section>
  );
}

function TechCard({ icon, name }: { icon: any; name: string }) {
  return (
    <Card className="flex flex-col items-center p-6 hover:shadow-md transition-shadow border">
      <CardContent className="flex flex-col items-center p-0">
        <div className="text-4xl mb-3 text-muted-foreground">{icon}</div>
        <p className="text-sm font-medium text-foreground">{name}</p>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*                           CONTRIBUTORS SECTION                               */
/* -------------------------------------------------------------------------- */

function ContributorsSection() {
  return (
    <section className="max-w-6xl mx-auto mb-16">
      <h2 className="text-3xl md:text-4xl font-semibold mb-8 text-foreground text-center">
        Project Contributors
      </h2>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">

        {/* ---------------------- YOUR CARD ---------------------- */}
        <ContributorCard
          name="Karan Aggarwal"
          role="Full-Stack Developer | Lead Architect | DevOps"
          bio="Built the end-to-end architecture, backend microservices, devops pipeline, and system design for Quick Clinic."
          instagram="your_instagram_link"
          linkedin="your_linkedin_link"
          github="your_github_link"
          portfolio="your_portfolio_link"
          mail="your_mail_here"
          codeforces="your_codeforces"
          leetcode="your_leetcode"
        />

        {/* ---------------------- DUMMY CONTRIBUTOR 1 ---------------------- */}
        <ContributorCard
          name="Contributor A"
          role="Frontend Developer"
          bio="Worked on UI components, animations, layout systems, and responsive design."
          instagram="#"
          linkedin="#"
          github="#"
          portfolio="#"
          mail="#"
          codeforces="#"
          leetcode="#"
        />

        {/* ---------------------- DUMMY CONTRIBUTOR 2 ---------------------- */}
        <ContributorCard
          name="Contributor B"
          role="Backend Engineer"
          bio="Responsible for database schema designs, API integrations, and performance optimization."
          instagram="#"
          linkedin="#"
          github="#"
          portfolio="#"
          mail="#"
          codeforces="#"
          leetcode="#"
        />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                           CONTRIBUTOR CARD                                   */
/* -------------------------------------------------------------------------- */

function ContributorCard({
  name,
  role,
  bio,
  instagram,
  linkedin,
  github,
  portfolio,
  mail,
  codeforces,
  leetcode,
}: any) {
  return (
    <Card className="hover:shadow-md transition-shadow border">
      <CardHeader>
        <CardTitle className="text-xl font-semibold text-foreground">
          {name}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-3 text-sm">{role}</p>
        <p className="text-muted-foreground text-sm mb-6">{bio}</p>
        <div className="flex flex-wrap gap-3 text-lg">
          <a href={github} target="_blank" rel="noopener noreferrer"><SiGithub /></a>
          <a href={linkedin} target="_blank" rel="noopener noreferrer"><SiLinkedin color="#0A66C2" /></a>
          <a href={instagram} target="_blank" rel="noopener noreferrer"><SiInstagram color="#E1306C" /></a>
          <a href={portfolio} target="_blank" rel="noopener noreferrer"><Globe /></a>
          <a href={`mailto:${mail}`}><Mail /></a>
          <a href={leetcode} target="_blank" rel="noopener noreferrer"><SiLeetcode color="#FFA116" /></a>
          <a href={codeforces} target="_blank" rel="noopener noreferrer"><SiCodeforces color="#1F8ACB" /></a>
        </div>
      </CardContent>
    </Card>
  );
}
