import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function NotFoundPage() {
  return (
    <section
      className="min-h-screen bg-background py-10"
      style={{ fontFamily: "'Arvo', serif" }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Arvo&display=swap');`}</style>

      <div className="max-w-4xl mx-auto px-4">
        <div className="flex justify-center">
          <div className="w-full sm:w-10/12 text-center">

            <h1 className="text-[80px] font-bold text-green-500">
              404
            </h1>
            <div
              className="h-[400px] bg-center bg-no-repeat bg-cover"
              style={{
                backgroundImage:
                  "url('https://cdn.dribbble.com/users/285475/screenshots/2083086/dribbble_1.gif')",
              }}
            />
            <div className="-mt-12">
              <h3 className="text-3xl font-bold mb-3 text-foreground">
                Page Not Found
              </h3>
              <p className="text-muted-foreground mb-4 max-w-md mx-auto">
                Don&apos;t worry, even the best data sometimes gets lost in the internet.
              </p>
              <Link
                href="/"
                className="inline-flex items-center px-5 py-2.5 bg-green-500 text-primary-foreground mt-4 hover:bg-primary/90 transition-colors duration-200 rounded-md"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Link>
            </div>

          </div>
        </div>
      </div>

      <footer className="mt-12 text-center text-sm text-muted-foreground">
        If you believe this is an error, please contact our support team.
      </footer>
    </section>
  )
}