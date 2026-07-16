import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

function App() {
  const [jobUrl, setJobUrl] = useState('')
  const [instructions, setInstructions] = useState('')
  const [running, setRunning] = useState(false)

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
  }

  return (
    <div className="dark min-w-80 bg-background p-4 text-foreground">
      <div className="mx-auto max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>AI Auto Apply</CardTitle>
            <CardDescription>
              Paste a job link and let AI prepare your application draft.
            </CardDescription>
          </CardHeader>

          <form
            onSubmit={(e) => {
              onSubmit(e)
              setRunning(true)
              setTimeout(() => setRunning(false), 1500)
            }}
          >
            <CardContent>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="jobUrl">Job URL</Label>
                  <Input
                    id="jobUrl"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    placeholder="https://company.com/jobs/123"
                    value={jobUrl}
                    onChange={(e) => setJobUrl(e.target.value)}
                    required
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="instructions">
                    AI instructions (optional)
                  </Label>
                  <Textarea
                    id="instructions"
                    rows={4}
                    placeholder="Example: emphasize React/TypeScript experience and leadership."
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                  />
                </div>

                {running ? (
                  <p className="text-sm text-muted-foreground">
                    AI is preparing your draft…
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No sign-up needed for this UI prototype.
                  </p>
                )}
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-2">
              <Button type="submit" className="w-full" disabled={running}>
                {running ? 'Starting…' : 'Start Auto Apply'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={!running}
                onClick={() => setRunning(false)}
              >
                Stop
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  )
}

export default App
