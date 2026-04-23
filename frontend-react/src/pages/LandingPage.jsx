import { Link } from 'react-router-dom'

const features = [
  {
    icon: 'sentiment_satisfied',
    title: 'Emotion Detection',
    text: 'Advanced biometric tracking captures subtle shifts in mood through voice and facial cues during sessions.',
    colors: 'bg-tg-100 text-tg-700 group-hover:bg-tg-600 group-hover:text-white',
  },
  {
    icon: 'analytics',
    title: 'Insight Reports',
    text: 'Summarized consultation notes and trend analysis delivered directly to the therapist dashboard.',
    colors: 'bg-tg-100 text-tg-700 group-hover:bg-tg-600 group-hover:text-white',
  },
  {
    icon: 'video_chat',
    title: 'Secure Telehealth',
    text: 'Integrated, encrypted high-definition video portal with built-in emotional pulse tracking.',
    colors: 'bg-tg-100 text-tg-700 group-hover:bg-tg-600 group-hover:text-white',
  },
  {
    icon: 'auto_stories',
    title: 'Dynamic Journaling',
    text: 'A private space for patients where guided prompts help articulate complex feelings between sessions.',
    colors: 'bg-tg-100 text-tg-700 group-hover:bg-tg-600 group-hover:text-white',
  },
]

export default function LandingPage() {
  return (
    <div className="bg-[#f8faf9] text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-2xl">
        <nav className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 md:px-8">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <img src="/logo.jpeg" alt="Serien" className="landing-brand-logo" />
              <span className="text-2xl font-extrabold tracking-tight text-tg-700">Serien</span>
            </div>
            <div className="hidden items-center gap-6 md:flex">
              <a className="border-b-2 border-tg-600 text-tg-700" href="#hero">Home</a>
              <a className="font-medium text-slate-500 transition-colors hover:text-tg-700" href="#features">Platform</a>
              <a className="font-medium text-slate-500 transition-colors hover:text-tg-700" href="#insights">Insights</a>
            </div>
          </div>

          <div />
        </nav>
      </header>

      <main>
        <section
          id="hero"
          className="relative flex min-h-[92vh] items-center overflow-hidden"
          style={{
            backgroundImage:
              'radial-gradient(circle at 2px 2px, rgba(47,191,113,0.06) 1px, transparent 0)',
            backgroundSize: '40px 40px',
          }}
        >
          <div className="absolute inset-0">
            <div className="absolute -left-20 top-1/4 h-96 w-96 rounded-full bg-tg-200/40 blur-[120px]" />
            <div className="absolute -right-20 bottom-1/4 h-80 w-80 rounded-full bg-tg-200/40 blur-[110px]" />
          </div>

          <div className="container relative z-10 mx-auto grid grid-cols-1 items-center gap-14 px-6 py-16 md:grid-cols-2 md:px-8">
            <div className="max-w-2xl">
              <span className="mb-6 inline-block rounded-full bg-tg-100 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-tg-700">
                The Future of Care
              </span>
              <h1 className="mb-6 text-4xl font-extrabold leading-tight tracking-tight text-slate-900 md:text-6xl">
                Emotional Insight for{' '}
                <span className="bg-gradient-to-br from-tg-700 to-tg-400 bg-clip-text text-transparent">
                  Better Therapy
                </span>
              </h1>
              <p className="mb-10 max-w-lg text-lg leading-relaxed text-slate-600 md:text-xl">
                Serien bridges the gap between sessions with real-time biometric analysis and guided journals,
                helping therapists understand what words can&apos;t always say.
              </p>

              <div className="flex flex-col gap-4 sm:flex-row">
                <Link
                  to="/login"
                  className="rounded-xl bg-gradient-to-br from-tg-700 to-tg-500 px-8 py-4 text-center font-semibold text-white shadow-[0_12px_32px_rgba(47,191,113,0.2)] transition hover:scale-[1.02]"
                >
                  Get Started
                </Link>
                
              </div>
            </div>

            <div className="relative hidden md:block">
              <div className="rounded-[32px] border border-white/30 bg-white/70 p-4 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.12)] backdrop-blur-2xl">
                <img
                  alt="Dashboard Preview"
                  className="aspect-[4/3] w-full rounded-[24px] object-cover"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuB3p1so_STMAgYIcsNRXn5xBUY82gK-WUkvGb_7oKvwZPtO7tpQy9sqt3IchOuaviBnke4YJZBX4Nr3mmLgDrMmVNpEcKaoqT6eFiioIus7vnVYcF5ted-a0tygwwMg7cpTY6Np1LMUkCYWHxKusjrEbmX9yIc57QrmXw7AOMxojWqRqymMgIggAIRJt0hsfl_w7BQxtuS94bCHJT95ZdTsZUFK3QK4Qp9c4yLo6FrKEPrcqBu8tTlUEYPVqdDJJ_plNYIeqbAk1Kw"
                />

                <div className="absolute -bottom-6 -left-6 max-w-xs rounded-2xl border border-white/40 bg-tg-50/80 p-6 shadow-xl backdrop-blur-xl">
                  <div className="flex items-start gap-4">
                    <div className="rounded-lg bg-tg-700 p-2 text-white">
                      <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                    </div>
                    <div>
                      <p className="mb-1 text-sm font-bold text-tg-900">Insight</p>
                      <p className="text-xs leading-relaxed text-slate-700">
                        Detected elevated stress patterns between 2 PM and 4 PM. Suggesting mindfulness prompt.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="bg-[#f2f4f3] py-24 md:py-32">
          <div className="container mx-auto px-6 md:px-8">
            <div className="mx-auto mb-16 max-w-2xl text-center md:mb-20">
              <h2 className="mb-4 text-4xl font-bold tracking-tight text-slate-900">Holistic Digital Ecosystem</h2>
              <p className="text-slate-600">Sophisticated tools designed to enhance empathy, not replace it.</p>
            </div>

            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="group rounded-xl bg-white p-8 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg"
                >
                  <div
                    className={`mb-6 flex h-12 w-12 items-center justify-center rounded-xl transition-colors ${feature.colors}`}
                  >
                    <span className="material-symbols-outlined">{feature.icon}</span>
                  </div>
                  <h3 className="mb-3 text-xl font-bold text-slate-900">{feature.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-600">{feature.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="insights" className="bg-[#f8faf9] py-24 md:py-32">
          <div className="container mx-auto grid grid-cols-1 items-center gap-14 px-6 md:px-8 lg:grid-cols-12 lg:gap-16">
            <div className="order-2 lg:order-1 lg:col-span-7">
              <div className="relative">
                <img
                  alt="Therapy Session"
                  className="rounded-[40px] shadow-2xl"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuB76Z4hnGBlJCvvpipHb1OyBDxnBNyhv6DtFqGrVfAc-WKUG3HoDUbmGAWz6Q4pTNGOTjNq4JEwhnkUUnKDw-nWUGQ3pjEQWMEUTUAQm4Nyyv-8rYnclL6pLyc9F6yPqk1d3PMNWjilb0GacuqyEfBXKGo0He0FMwG6sXyHioDX8JB3mqTdqkjUw4RZkelbQBAFTDI5jnnyXUmJDsqjeMQuqR1FCGf1zYVkxa1C-ZTZVFau20S1qp1jLtKRctYIHmWjXakaOoCM5Zg"
                />
                <div className="absolute -right-10 -top-10 hidden h-48 w-48 rounded-full bg-tg-200/40 xl:block" />
              </div>
            </div>

            <div className="order-1 lg:order-2 lg:col-span-5">
              <span className="mb-6 block text-xs font-bold uppercase tracking-[0.18em] text-tg-700">Our Philosophy</span>
              <h2 className="mb-8 text-4xl font-bold leading-tight tracking-tight text-slate-900 md:text-5xl">
                Precision Meets Empathy
              </h2>
              <p className="mb-8 text-lg leading-relaxed text-slate-600">
                Data shouldn&apos;t be cold. At Serien, we believe that quantitative insights should serve qualitative
                connection. Our tools allow therapists to see the invisible progress a patient makes.
              </p>

              <div className="space-y-6">
                <div className="flex items-center gap-4"><div className="h-2 w-2 rounded-full bg-tg-700" /><span className="font-medium">98% client privacy satisfaction</span></div>
                <div className="flex items-center gap-4"><div className="h-2 w-2 rounded-full bg-tg-700" /><span className="font-medium">HIPAA and GDPR compliant infrastructure</span></div>
                <div className="flex items-center gap-4"><div className="h-2 w-2 rounded-full bg-tg-700" /><span className="font-medium">Developed with clinical psychologists</span></div>
              </div>
            </div>
          </div>
        </section>

        <section id="cta" className="py-20 md:py-24">
          <div className="container mx-auto px-6 md:px-8">
            <div className="relative overflow-hidden rounded-[48px] bg-tg-700 p-10 md:p-16">
              <div className="absolute inset-0 bg-gradient-to-br from-tg-700 to-tg-500 opacity-60" />
              <div className="absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-white/10 blur-[80px]" />

              <div className="relative z-10 mx-auto max-w-3xl text-center">
                <h2 className="mb-8 text-4xl font-bold tracking-tight text-white md:text-5xl">
                  Ready to transform your clinical practice?
                </h2>
                <p className="mb-12 text-lg text-tg-100 md:text-xl">
                  Join over 5,000 mental health professionals using Serien to provide deeper, more insightful care.
                </p>
                <div className="flex flex-wrap justify-center gap-5 md:gap-6">
                  <Link
                    to="/login"
                    className="rounded-2xl bg-white px-10 py-5 font-bold text-tg-700 shadow-xl transition-all hover:scale-105"
                  >
                    Get Started Now
                  </Link>
                  <button
                    type="button"
                    className="rounded-2xl border-2 border-white/30 bg-transparent px-10 py-5 font-bold text-white transition-all hover:bg-white/10"
                  >
                    Schedule a Consultation
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#f2f4f3] py-16">
        <div className="container mx-auto grid grid-cols-1 gap-12 px-6 md:grid-cols-4 md:px-8">
          <div className="md:col-span-2">
            <span className="mb-6 block text-2xl font-bold text-tg-800">Serien</span>
            <p className="mb-8 max-w-sm text-slate-600">
              Empowering mental health professionals with artificial intelligence designed for emotional intelligence.
            </p>
            <div className="flex gap-4 text-tg-700">
              <span className="material-symbols-outlined cursor-pointer">public</span>
              <span className="material-symbols-outlined cursor-pointer">mail</span>
              <span className="material-symbols-outlined cursor-pointer">verified</span>
            </div>
          </div>

          <div>
            <h4 className="mb-6 font-bold">Product</h4>
            <ul className="space-y-4 text-sm text-slate-600">
              <li><a className="transition-colors hover:text-tg-700" href="#features">Features</a></li>
              <li><a className="transition-colors hover:text-tg-700" href="#cta">Pricing</a></li>
              <li><a className="transition-colors hover:text-tg-700" href="#insights">Security</a></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-6 font-bold">Resources</h4>
            <ul className="space-y-4 text-sm text-slate-600">
              <li><a className="transition-colors hover:text-tg-700" href="#insights">Case Studies</a></li>
              <li><a className="transition-colors hover:text-tg-700" href="#features">Documentation</a></li>
              <li><a className="transition-colors hover:text-tg-700" href="#cta">Community</a></li>
            </ul>
          </div>
        </div>

        <div className="container mx-auto mt-16 border-t border-slate-300/50 px-6 pt-8 text-center text-xs text-slate-500 md:px-8">
          © 2026 Serien Technologies. All rights reserved. Precision Mental Health.
        </div>
      </footer>
    </div>
  )
}
