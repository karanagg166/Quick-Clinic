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

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-gray-800 text-white p-10">

      {/* PAGE HEADER */}
      <h1 className="text-5xl font-extrabold text-center mb-8 bg-gradient-to-r from-cyan-400 to-blue-500 text-transparent bg-clip-text drop-shadow-lg">
        About Quick Clinic
      </h1>

      <p className="text-center text-gray-300 max-w-3xl mx-auto text-lg mb-16">
        Quick Clinic is a modern healthcare platform built to simplify doctor–patient interactions. 
        From real-time chat to appointment scheduling, we deliver a seamless, secure, and scalable experience using cutting-edge technologies.
      </p>

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
    <section className="max-w-6xl mx-auto mb-24">
      <h2 className="text-4xl font-semibold mb-10 text-cyan-400 text-center">
        Technologies Used
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-8">

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
    <div className="flex flex-col items-center p-6 bg-white/10 backdrop-blur-md rounded-2xl shadow-md hover:shadow-2xl hover:bg-white/20 transition cursor-pointer border border-white/10">
      <div className="text-4xl mb-3">{icon}</div>
      <p className="text-gray-200 font-medium">{name}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                           CONTRIBUTORS SECTION                               */
/* -------------------------------------------------------------------------- */

function ContributorsSection() {
  return (
    <section className="max-w-6xl mx-auto mb-24">
      <h2 className="text-4xl font-semibold mb-10 text-blue-400 text-center">
        Project Contributors
      </h2>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-10">

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
    <div className="bg-white/10 backdrop-blur-lg p-8 rounded-2xl shadow-lg border border-white/10 hover:shadow-2xl transition hover:-translate-y-1">

      <h3 className="text-2xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
        {name}
      </h3>

      <p className="text-gray-300 mb-3">{role}</p>

      <p className="text-gray-400 text-sm mb-6">{bio}</p>

      {/* Social Icons */}
      <div className="flex flex-wrap gap-4 text-2xl">

        <a href={github} target="_blank"><SiGithub /></a>
        <a href={linkedin} target="_blank"><SiLinkedin color="#0A66C2" /></a>
        <a href={instagram} target="_blank"><SiInstagram color="#E1306C" /></a>
        <a href={portfolio} target="_blank"><Globe /></a>
        <a href={`mailto:${mail}`}><Mail /></a>
        <a href={leetcode} target="_blank"><SiLeetcode color="#FFA116" /></a>
        <a href={codeforces} target="_blank"><SiCodeforces color="#1F8ACB" /></a>

      </div>
    </div>
  );
}
