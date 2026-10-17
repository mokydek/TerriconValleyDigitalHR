import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { Award, Check, CheckCircle2, ChevronRight, Clock, Lock, Printer, RotateCcw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { tr, useI18n } from '@/lib/i18n'
import { useCompleteLesson, useCourse, useSubmitQuiz } from '@/lib/api'
import { fmtDate, fullName } from '@/lib/format'
import type { QuizResult } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge, Button, Card, ErrorBox, PageLoader, Progress, ProgressRing } from '@/components/ui'

type View = { kind: 'lesson'; index: number } | { kind: 'quiz' } | { kind: 'result'; result: QuizResult } | { kind: 'certificate' }

export default function CoursePage() {
  const { slug } = useParams()
  const { me } = useAuth()
  const { t } = useI18n()
  const { data, isLoading, error, refetch } = useCourse(slug)
  const complete = useCompleteLesson()
  const submit = useSubmitQuiz()
  const [view, setView] = useState<View | null>(null)
  const [answers, setAnswers] = useState<Record<string, number>>({})

  const lessons = useMemo(() => data?.lessons ?? [], [data])
  const done = data?.done ?? new Set<string>()
  const doneCount = lessons.filter((l) => done.has(l.id)).length
  const allLessonsDone = lessons.length > 0 && doneCount === lessons.length
  const completed = data?.assignment?.status === 'completed'
  const progress = data?.assignment?.progress ?? 0

  // Начальный экран: первый непройденный урок, тест или сертификат
  useEffect(() => {
    if (!data || view) return
    if (completed) setView({ kind: 'certificate' })
    else if (allLessonsDone) setView({ kind: 'quiz' })
    else setView({ kind: 'lesson', index: Math.max(0, lessons.findIndex((l) => !done.has(l.id))) })
  }, [data, view, completed, allLessonsDone, lessons, done])

  if (isLoading || !view) return error ? <ErrorBox error={error} onRetry={() => void refetch()} /> : <PageLoader />
  if (!data) return null
  const { course, questions } = data

  const markDone = async (index: number) => {
    const lesson = lessons[index]
    try {
      if (!done.has(lesson.id)) await complete.mutateAsync(lesson.id)
      if (index + 1 < lessons.length) setView({ kind: 'lesson', index: index + 1 })
      else setView({ kind: 'quiz' })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const sendQuiz = async () => {
    try {
      const result = await submit.mutateAsync({ courseId: course.id, answers })
      setView({ kind: 'result', result })
      if (result.passed) toast.success(t('course.passedToast', { score: result.score }))
      else toast.error(t('course.failedToast', { score: result.score, pass: result.pass_score }))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div>
      <Link to="/academy" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-brand-700">
        ← Jana Academy
      </Link>
      <Card className="mb-5 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-50 text-3xl">{course.emoji}</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-1.5">
              {course.is_mandatory && <Badge className="bg-amber-50 text-amber-800 ring-amber-200">{t('academy.mandatory')}</Badge>}
              <Badge className="bg-canvas text-ink-soft ring-line">
                <Clock className="h-3 w-3" /> {t('academy.minutes', { n: course.duration_minutes })}
              </Badge>
              <Badge className="bg-canvas text-ink-soft ring-line">{t('course.passScore', { n: course.pass_score })}</Badge>
              {data.assignment?.due_date && !completed && <Badge className="bg-canvas text-ink-soft ring-line">{t('academy.dueDate', { date: fmtDate(data.assignment.due_date) })}</Badge>}
            </div>
            <h1 className="mt-2 text-xl font-bold sm:text-2xl">{course.title}</h1>
            <p className="mt-1 text-sm text-muted">{course.description}</p>
          </div>
          <ProgressRing value={progress} size={76} stroke={8} />
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        {/* Оглавление */}
        <Card className="h-fit p-2 lg:sticky lg:top-20">
          <ol>
            {lessons.map((l, i) => {
              const isDone = done.has(l.id)
              const active = view.kind === 'lesson' && view.index === i
              return (
                <li key={l.id}>
                  <button
                    onClick={() => setView({ kind: 'lesson', index: i })}
                    className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition', active ? 'bg-brand-50 text-brand-800' : 'hover:bg-canvas')}
                  >
                    <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold', isDone ? 'bg-brand-500 text-white' : 'bg-canvas text-muted')}>
                      {isDone ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{l.title}</span>
                      <span className="text-xs text-muted">{t('academy.minutes', { n: l.duration_minutes })}</span>
                    </span>
                  </button>
                </li>
              )
            })}
            <li>
              <button
                disabled={!allLessonsDone}
                onClick={() => setView(completed ? { kind: 'certificate' } : { kind: 'quiz' })}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60',
                  (view.kind === 'quiz' || view.kind === 'result' || view.kind === 'certificate') ? 'bg-brand-50 text-brand-800' : 'hover:bg-canvas',
                )}
              >
                <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full', completed ? 'bg-brand-500 text-white' : 'bg-canvas text-muted')}>
                  {completed ? <Award className="h-3.5 w-3.5" /> : allLessonsDone ? '✎' : <Lock className="h-3 w-3" />}
                </span>
                <span className="font-medium">
                  {completed ? t('course.certificate') : t('academy.test')}
                  <span className="block text-xs font-normal text-muted">{t('course.questions', { n: questions.length })}</span>
                </span>
              </button>
            </li>
          </ol>
          <div className="px-3 pt-2 pb-3">
            <Progress value={progress} className="h-1.5" />
            <div className="mt-1.5 text-xs text-muted">{t('course.lessonsDone', { done: doneCount, total: lessons.length })}</div>
          </div>
        </Card>

        {/* Контент */}
        <div className="min-w-0">
          {view.kind === 'lesson' && lessons[view.index] && (
            <Card className="p-6 sm:p-8" data-testid="lesson-view">
              <div className="text-xs font-semibold tracking-wide text-brand-700 uppercase">{t('course.lessonOf', { n: view.index + 1, total: lessons.length })}</div>
              <h2 className="mt-1 text-xl font-bold">{lessons[view.index].title}</h2>
              <div className="prose-jana mt-4">
                <ReactMarkdown>{lessons[view.index].content}</ReactMarkdown>
              </div>
              <div className="mt-8 flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-between">
                <Button variant="ghost" disabled={view.index === 0} onClick={() => setView({ kind: 'lesson', index: view.index - 1 })}>
                  ← {t('common.back')}
                </Button>
                <Button onClick={() => void markDone(view.index)} loading={complete.isPending} icon={done.has(lessons[view.index].id) ? <CheckCircle2 className="h-4 w-4" /> : undefined} data-testid="lesson-next">
                  {done.has(lessons[view.index].id) ? t('course.doneNext') : view.index + 1 < lessons.length ? t('course.studiedNext') : t('course.studiedToTest')}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          )}

          {view.kind === 'quiz' && (
            <Card className="p-6 sm:p-8" data-testid="quiz-view">
              <h2 className="text-xl font-bold">{t('academy.test')}</h2>
              <p className="mt-1 text-sm text-muted">{t('course.quizInfo', { n: questions.length, pass: course.pass_score })}</p>
              <ol className="mt-6 space-y-6">
                {questions.map((q, qi) => (
                  <li key={q.id}>
                    <div className="font-medium text-ink">
                      {qi + 1}. {q.question}
                    </div>
                    <div className="mt-2.5 grid gap-2">
                      {q.options.map((opt, oi) => (
                        <label
                          key={oi}
                          className={cn(
                            'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition',
                            answers[q.id] === oi ? 'border-brand-500 bg-brand-50 text-brand-900' : 'border-line hover:border-brand-300',
                          )}
                        >
                          <input type="radio" name={q.id} className="h-4 w-4 accent-brand-600" checked={answers[q.id] === oi} onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))} />
                          {opt}
                        </label>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-8 flex items-center justify-between border-t border-line pt-5">
                <span className="text-sm text-muted">{t('course.answered', { n: Object.keys(answers).length, total: questions.length })}</span>
                <Button disabled={Object.keys(answers).length < questions.length} loading={submit.isPending} onClick={() => void sendQuiz()} data-testid="quiz-submit">
                  {t('course.submit')}
                </Button>
              </div>
            </Card>
          )}

          {view.kind === 'result' && (
            <Card className="p-6 sm:p-8">
              <div className="flex flex-col items-center text-center">
                {view.result.passed ? <CheckCircle2 className="h-14 w-14 text-brand-600" /> : <XCircle className="h-14 w-14 text-rose-500" />}
                <h2 className="mt-3 text-2xl font-bold" data-testid="quiz-score">
                  {view.result.score}%
                </h2>
                <p className="mt-1 text-muted">{view.result.passed ? t('course.passedText') : t('course.failedText', { pass: view.result.pass_score })}</p>
                <p className="mt-1 text-sm text-muted">{t('course.resultStats', { correct: view.result.correct, total: view.result.total, attempt: view.result.attempts })}</p>
              </div>
              <ol className="mt-6 space-y-3">
                {questions.map((q, i) => {
                  const r = view.result.results.find((x) => x.question_id === q.id)
                  return (
                    <li key={q.id} className={cn('rounded-xl border px-4 py-3 text-sm', r?.correct ? 'border-brand-200 bg-brand-50/50' : 'border-rose-200 bg-rose-50/50')}>
                      <div className="flex items-start gap-2 font-medium">
                        {r?.correct ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />}
                        {i + 1}. {q.question}
                      </div>
                      {!r?.correct && r?.explanation && <div className="mt-1 pl-6 text-muted">{r.explanation}</div>}
                    </li>
                  )
                })}
              </ol>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                {view.result.passed ? (
                  <Button icon={<Award className="h-4 w-4" />} onClick={() => setView({ kind: 'certificate' })}>
                    {t('course.myCertificate')}
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" onClick={() => setView({ kind: 'lesson', index: 0 })}>
                      {t('course.review')}
                    </Button>
                    <Button
                      icon={<RotateCcw className="h-4 w-4" />}
                      onClick={() => {
                        setAnswers({})
                        setView({ kind: 'quiz' })
                      }}
                    >
                      {t('course.retake')}
                    </Button>
                  </>
                )}
              </div>
            </Card>
          )}

          {view.kind === 'certificate' && me && (
            <div>
              <div className="print-sheet relative overflow-hidden rounded-3xl border-2 border-brand-200 bg-white p-8 text-center shadow-[var(--shadow-card)] sm:p-12" data-testid="certificate">
                <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-brand-50" />
                <div className="absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-brand-50" />
                <div className="relative">
                  <div className="text-sm font-extrabold tracking-[0.3em] text-brand-700">JANA ACADEMY</div>
                  <Award className="mx-auto mt-5 h-14 w-14 text-brand-600" />
                  <div className="mt-4 text-sm tracking-wide text-muted uppercase">{t('course.certificate')}</div>
                  <div className="mt-2 text-2xl font-bold sm:text-3xl">{fullName(me)}</div>
                  <p className="mx-auto mt-3 max-w-md text-muted">{t('course.certCompleted')}</p>
                  <p className="mt-1 text-xl font-semibold text-ink">{t('course.certTitle', { title: course.title })}</p>
                  <p className="mt-3 text-muted">
                    {tr('course.certScore', {
                      score: <b className="text-brand-700">{data.assignment?.score ?? '–'}%</b>,
                      date: fmtDate(data.assignment?.completed_at ?? new Date()),
                    })}
                  </p>
                  <div className="mt-8 text-xs text-muted">{t('course.certFooter')}</div>
                </div>
              </div>
              <div className="no-print mt-4 flex justify-center gap-2">
                <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
                  {t('course.print')}
                </Button>
                <Link to="/academy">
                  <Button>{t('course.toCourses')}</Button>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
