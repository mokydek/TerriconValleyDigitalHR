import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import {
  ArrowLeft,
  Award,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Lock,
  PenLine,
  PlayCircle,
  Printer,
  RotateCcw,
  Target,
  XCircle,
} from '@/components/icons'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { tr, useI18n, type I18nKey } from '@/lib/i18n'
import { useAnswerCheck, useCompleteLesson, useCourse, useSubmitQuiz } from '@/lib/api'
import { fmtDate, fullName } from '@/lib/format'
import type { Lesson, LessonCheck, QuizResult } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge, Button, Card, ErrorBox, PageLoader, Progress, ProgressRing } from '@/components/ui'
import { CourseIcon } from '@/components/academy/CourseIcon'
import { Burst } from '@/components/tasks/TaskParts'

type View = { kind: 'lesson'; index: number } | { kind: 'quiz' } | { kind: 'result'; result: QuizResult } | { kind: 'certificate' }

const LESSON_ICON: Record<Lesson['kind'], typeof BookOpen> = { article: BookOpen, video: PlayCircle, practice: Target }

export default function CoursePage() {
  const { slug } = useParams()
  const { me } = useAuth()
  const { t } = useI18n()
  const qc = useQueryClient()
  const { data, isLoading, error, refetch } = useCourse(slug)
  const complete = useCompleteLesson()
  const submit = useSubmitQuiz()
  const [view, setView] = useState<View | null>(null)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [burst, setBurst] = useState(0)

  const lessons = useMemo(() => data?.lessons ?? [], [data])
  const done = data?.done ?? new Set<string>()
  const doneCount = lessons.filter((l) => done.has(l.id)).length
  const allLessonsDone = lessons.length > 0 && doneCount === lessons.length
  const completed = data?.assignment?.status === 'completed'
  const progress = data?.assignment?.progress ?? 0

  useEffect(() => {
    if (!data || view) return
    if (completed) setView({ kind: 'certificate' })
    else if (allLessonsDone) setView({ kind: 'quiz' })
    else setView({ kind: 'lesson', index: Math.max(0, lessons.findIndex((l) => !done.has(l.id))) })
  }, [data, view, completed, allLessonsDone, lessons, done])

  if (isLoading || !view) return error ? <ErrorBox error={error} onRetry={() => void refetch()} /> : <PageLoader />
  if (!data) return null
  const { course, questions, checks, solved } = data

  const goNext = (index: number) => {
    if (index + 1 < lessons.length) setView({ kind: 'lesson', index: index + 1 })
    else setView({ kind: 'quiz' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const markDone = async (index: number) => {
    const lesson = lessons[index]
    try {
      if (!done.has(lesson.id)) await complete.mutateAsync(lesson.id)
      goNext(index)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const sendQuiz = async () => {
    try {
      const result = await submit.mutateAsync({ courseId: course.id, answers })
      setView({ kind: 'result', result })
      if (result.passed) {
        toast.success(t('course.passedToast', { score: result.score }))
        setBurst(Date.now())
        void qc.invalidateQueries({ queryKey: ['tasks'] })
      } else toast.error(t('course.failedToast', { score: result.score, pass: result.pass_score }))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const testView = view.kind === 'quiz' || view.kind === 'result' || view.kind === 'certificate'

  return (
    <div>
      <Link to="/academy" className="mb-3 inline-flex items-center gap-1 text-sm text-muted transition hover:-translate-x-0.5 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Jana Academy
      </Link>

      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <CourseIcon name={course.icon} className="h-16 w-16" />
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
            {course.summary && (
              <p className="mt-2 flex items-start gap-1.5 text-sm text-ink-soft">
                <Target className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                <span>
                  <b className="font-semibold">{t('c2.youWillLearn')}</b> {course.summary}
                </span>
              </p>
            )}
          </div>
          <ProgressRing value={progress} size={76} stroke={8} />
        </div>
        {/* Полоса освоения: каждый урок и тест отдельным сегментом, как в Khan Academy */}
        <div className="flex gap-1 border-t border-line bg-canvas/60 px-5 py-3" aria-label={t('c2.mastery')}>
          {lessons.map((l, i) => (
            <button
              key={l.id}
              title={l.title}
              onClick={() => setView({ kind: 'lesson', index: i })}
              className={cn(
                'h-2.5 flex-1 rounded-full transition-all duration-500 hover:scale-y-150',
                done.has(l.id) ? 'bg-brand-500' : view.kind === 'lesson' && view.index === i ? 'bg-brand-200 ring-2 ring-brand-500' : 'bg-line',
              )}
            />
          ))}
          <span className={cn('h-2.5 w-10 rounded-full transition-all', completed ? 'bg-amber-400' : 'bg-line')} title={t('academy.test')} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[310px_1fr]">
        <Card className="h-fit p-3 lg:sticky lg:top-20">
          <div className="px-2 pt-1 pb-2 text-xs font-semibold tracking-wide text-muted uppercase">{t('c2.path')}</div>
          <ol className="relative">
            <span className="absolute top-4 bottom-12 left-[23px] w-0.5 bg-line" aria-hidden />
            {lessons.map((l, i) => {
              const isDone = done.has(l.id)
              const active = view.kind === 'lesson' && view.index === i
              const Icon = LESSON_ICON[l.kind]
              return (
                <li key={l.id} className="relative">
                  <button
                    onClick={() => setView({ kind: 'lesson', index: i })}
                    className={cn('flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm transition active:scale-[0.98]', active ? 'bg-brand-50' : 'hover:bg-canvas')}
                    data-testid={`path-${i}`}
                  >
                    <span
                      className={cn(
                        'relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full ring-4 ring-white transition',
                        isDone ? 'bg-brand-600 text-white' : active ? 'bg-white text-brand-700 outline-2 outline-brand-500' : 'bg-canvas text-muted',
                      )}
                    >
                      {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block leading-snug font-medium', active && 'text-brand-800')}>{l.title}</span>
                      <span className="text-xs text-muted">
                        {t(`c2.kind.${l.kind}` as I18nKey)} · {t('academy.minutes', { n: l.duration_minutes })}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
            <li className="relative">
              <button
                disabled={!allLessonsDone && !completed}
                onClick={() => setView(completed ? { kind: 'certificate' } : { kind: 'quiz' })}
                className={cn('flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60', testView ? 'bg-brand-50' : 'hover:bg-canvas')}
                data-testid="path-test"
              >
                <span className={cn('relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full ring-4 ring-white', completed ? 'bg-amber-400 text-white' : 'bg-canvas text-muted')}>
                  {completed ? <Award className="h-4 w-4" /> : allLessonsDone ? <PenLine className="h-4 w-4" /> : <Lock className="h-3.5 w-3.5" />}
                </span>
                <span className="font-medium">
                  {completed ? t('course.certificate') : t('academy.test')}
                  <span className="block text-xs font-normal text-muted">{allLessonsDone || completed ? t('course.questions', { n: questions.length }) : t('c2.testLocked')}</span>
                </span>
              </button>
            </li>
          </ol>
          <div className="px-2 pt-2 pb-1">
            <Progress value={progress} className="h-1.5" />
            <div className="mt-1.5 text-xs text-muted">{t('course.lessonsDone', { done: doneCount, total: lessons.length })}</div>
          </div>
        </Card>

        <div className="min-w-0">
          {view.kind === 'lesson' && lessons[view.index] && (
            <LessonView
              key={lessons[view.index].id}
              lesson={lessons[view.index]}
              index={view.index}
              total={lessons.length}
              isDone={done.has(lessons[view.index].id)}
              checks={checks.filter((c) => c.lesson_id === lessons[view.index].id)}
              solved={solved}
              busy={complete.isPending}
              onBack={() => setView({ kind: 'lesson', index: view.index - 1 })}
              onDone={() => void markDone(view.index)}
              onPracticeSolved={async () => {
                try {
                  await complete.mutateAsync(lessons[view.index].id)
                } catch (e) {
                  toast.error((e as Error).message)
                }
              }}
              onNext={() => goNext(view.index)}
            />
          )}

          {view.kind === 'quiz' && (
            <Card className="animate-rise p-6 sm:p-8" data-testid="quiz-view">
              <h2 className="text-xl font-bold">{t('academy.test')}</h2>
              <p className="mt-1 text-sm text-muted">{t('course.quizInfo', { n: questions.length, pass: course.pass_score })}</p>
              <Progress value={(100 * Object.keys(answers).length) / Math.max(1, questions.length)} className="mt-4 h-1.5" />
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
                            'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition active:scale-[0.99]',
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
            <Card className="animate-rise p-6 sm:p-8">
              <div className="relative flex flex-col items-center text-center">
                <Burst trigger={view.result.passed ? burst : 0} />
                {view.result.passed ? <CheckCircle2 className="h-14 w-14 animate-star text-brand-600" /> : <XCircle className="h-14 w-14 animate-wiggle text-rose-500" />}
                <h2 className="mt-3 text-2xl font-bold" data-testid="quiz-score">
                  {view.result.score}%
                </h2>
                <p className="mt-1 text-muted">{view.result.passed ? t('course.passedText') : t('course.failedText', { pass: view.result.pass_score })}</p>
                <p className="mt-1 text-sm text-muted">{t('course.resultStats', { correct: view.result.correct, total: view.result.total, attempt: view.result.attempts })}</p>
              </div>
              <ol className="stagger mt-6 space-y-3">
                {questions.map((q, i) => {
                  const r = view.result.results.find((x) => x.question_id === q.id)
                  return (
                    <li key={q.id} style={{ ['--i' as string]: i }} className={cn('rounded-xl border px-4 py-3 text-sm', r?.correct ? 'border-brand-200 bg-brand-50/50' : 'border-rose-200 bg-rose-50/50')}>
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
            <div className="animate-pop">
              <div className="print-sheet relative overflow-hidden rounded-3xl border-2 border-brand-200 bg-white p-8 text-center shadow-[var(--shadow-card)] sm:p-12" data-testid="certificate">
                <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-brand-50" />
                <div className="absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-brand-50" />
                <div className="relative">
                  <div className="text-sm font-extrabold tracking-[0.3em] text-brand-700">JANA ACADEMY</div>
                  <CourseIcon name={course.icon} className="mx-auto mt-5 h-16 w-16" />
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

/* ---------- Урок: статья, видео или практика ---------- */

function LessonView({
  lesson,
  index,
  total,
  isDone,
  checks,
  solved,
  busy,
  onBack,
  onDone,
  onPracticeSolved,
  onNext,
}: {
  lesson: Lesson
  index: number
  total: number
  isDone: boolean
  checks: LessonCheck[]
  solved: Set<string>
  busy: boolean
  onBack: () => void
  onDone: () => void
  onPracticeSolved: () => Promise<void>
  onNext: () => void
}) {
  const { t } = useI18n()
  const Icon = LESSON_ICON[lesson.kind]
  const nextLabel = isDone ? t('course.doneNext') : index + 1 < total ? (lesson.kind === 'video' ? t('c2.watchedNext') : t('course.studiedNext')) : t('course.studiedToTest')
  return (
    <Card className="animate-rise overflow-hidden" data-testid="lesson-view" data-kind={lesson.kind}>
      <div className="flex items-center gap-2 px-6 pt-6 sm:px-8 sm:pt-8">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-700">
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
          {t(`c2.kind.${lesson.kind}` as I18nKey)} · {t('course.lessonOf', { n: index + 1, total })} · {t('academy.minutes', { n: lesson.duration_minutes })}
        </span>
      </div>
      <h2 className="mt-2 px-6 text-xl font-bold sm:px-8 sm:text-2xl">{lesson.title}</h2>

      {lesson.kind === 'video' && lesson.video_id && (
        <div className="mt-5 px-6 sm:px-8">
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-ink shadow-[var(--shadow-pop)]">
            <iframe
              className="absolute inset-0 h-full w-full"
              src={`https://www.youtube-nocookie.com/embed/${lesson.video_id}?rel=0&modestbranding=1`}
              title={lesson.video_title ?? lesson.title}
              loading="lazy"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
            <span className="min-w-0 truncate">
              {lesson.video_title}
              {lesson.video_channel && <> · {lesson.video_channel}</>}
            </span>
            <a href={`https://www.youtube.com/watch?v=${lesson.video_id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
              {t('c2.openYoutube')} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      )}

      {lesson.content && (
        <div className="prose-jana px-6 pt-4 sm:px-8">
          <ReactMarkdown>{lesson.content}</ReactMarkdown>
        </div>
      )}

      {lesson.kind === 'practice' && checks.length > 0 ? (
        <Practice checks={checks} solved={solved} isDone={isDone} onSolved={onPracticeSolved} onNext={onNext} />
      ) : (
        <div className="mt-8 flex flex-col-reverse gap-2 border-t border-line px-6 py-5 sm:flex-row sm:justify-between sm:px-8">
          <Button variant="ghost" disabled={index === 0} onClick={onBack} icon={<ArrowLeft className="h-4 w-4" />}>
            {t('common.back')}
          </Button>
          <Button onClick={onDone} loading={busy} icon={isDone ? <CheckCircle2 className="h-4 w-4" /> : undefined} data-testid="lesson-next">
            {nextLabel}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </Card>
  )
}

/* ---------- Практика: вопрос за вопросом с проверкой сразу, как упражнения Khan Academy ---------- */

function Practice({
  checks,
  solved,
  isDone,
  onSolved,
  onNext,
}: {
  checks: LessonCheck[]
  solved: Set<string>
  isDone: boolean
  onSolved: () => Promise<void>
  onNext: () => void
}) {
  const { t } = useI18n()
  const answer = useAnswerCheck()
  const [solvedNow, setSolvedNow] = useState<Set<string>>(() => new Set(checks.filter((c) => solved.has(c.id)).map((c) => c.id)))
  const firstOpen = checks.findIndex((c) => !solvedNow.has(c.id))
  const [i, setI] = useState(firstOpen === -1 ? checks.length : firstOpen)
  const [pick, setPick] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<{ correct: boolean; explanation: string | null; correct_index: number | null } | null>(null)
  const [burst, setBurst] = useState(0)
  const finished = i >= checks.length
  const q = checks[i]

  const check = async () => {
    if (pick === null || !q) return
    try {
      const r = await answer.mutateAsync({ checkId: q.id, index: pick })
      setFeedback(r)
      if (r.correct) {
        const next = new Set(solvedNow).add(q.id)
        setSolvedNow(next)
        setBurst(Date.now())
        if (next.size === checks.length && !isDone) await onSolved()
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const advance = () => {
    setPick(null)
    setFeedback(null)
    let n = i + 1
    while (n < checks.length && solvedNow.has(checks[n].id)) n++
    setI(n)
  }

  return (
    <div className="mt-6 border-t border-line px-6 py-6 sm:px-8" data-testid="practice">
      <div className="mb-4 flex items-center gap-1.5">
        {checks.map((c, k) => (
          <span
            key={c.id}
            className={cn('h-2.5 flex-1 rounded-full transition-all duration-500', solvedNow.has(c.id) ? 'bg-brand-500' : k === i && !finished ? 'bg-brand-200' : 'bg-line')}
          />
        ))}
      </div>

      {finished ? (
        <div className="relative flex flex-col items-center py-6 text-center">
          <Burst trigger={burst} />
          <span className="grid h-14 w-14 animate-star place-items-center rounded-full bg-brand-600 text-white">
            <Check className="h-7 w-7" />
          </span>
          <div className="mt-3 text-lg font-bold">{t('c2.practiceDone')}</div>
          <p className="mt-1 text-sm text-muted">{t('c2.practiceDoneText', { n: checks.length })}</p>
          <Button className="mt-4" onClick={onNext} icon={<ChevronRight className="h-4 w-4" />} data-testid="practice-next">
            {t('c2.nextStep')}
          </Button>
        </div>
      ) : (
        <div key={q.id} className="animate-rise">
          <div className="text-xs font-semibold text-muted">{t('c2.questionOf', { n: i + 1, total: checks.length })}</div>
          <div className="mt-1 text-lg font-semibold text-ink">{q.question}</div>
          <div className="mt-4 grid gap-2">
            {q.options.map((opt, oi) => {
              const isPick = pick === oi
              const showCorrect = feedback && (feedback.correct ? isPick : feedback.correct_index === oi)
              const showWrong = feedback && !feedback.correct && isPick
              return (
                <button
                  key={oi}
                  type="button"
                  disabled={Boolean(feedback?.correct)}
                  onClick={() => {
                    setPick(oi)
                    if (feedback && !feedback.correct) setFeedback(null)
                  }}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-[15px] transition active:scale-[0.99]',
                    showCorrect
                      ? 'border-brand-500 bg-brand-50 text-brand-900'
                      : showWrong
                        ? 'animate-wiggle border-rose-400 bg-rose-50 text-rose-900'
                        : isPick
                          ? 'border-brand-400 bg-brand-50/50'
                          : 'border-line hover:border-brand-300',
                  )}
                  data-testid={`check-option-${oi}`}
                >
                  <span
                    className={cn(
                      'grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-xs font-bold',
                      showCorrect ? 'border-brand-600 bg-brand-600 text-white' : showWrong ? 'border-rose-500 bg-rose-500 text-white' : isPick ? 'border-brand-500 text-brand-700' : 'border-line text-muted',
                    )}
                  >
                    {showCorrect ? <Check className="h-4 w-4" /> : showWrong ? <XCircle className="h-4 w-4" /> : String.fromCharCode(65 + oi)}
                  </span>
                  {opt}
                </button>
              )
            })}
          </div>

          {feedback && (
            <div className={cn('relative mt-4 animate-rise rounded-xl px-4 py-3 text-sm', feedback.correct ? 'bg-brand-50 text-brand-900' : 'bg-rose-50 text-rose-900')}>
              <Burst trigger={feedback.correct ? burst : 0} />
              <div className="font-semibold">{feedback.correct ? t('c2.correct') : t('c2.wrong')}</div>
              {(feedback.correct || feedback.correct_index !== null) && feedback.explanation && <div className="mt-0.5">{feedback.explanation}</div>}
            </div>
          )}

          <div className="mt-5 flex justify-end">
            {feedback?.correct ? (
              <Button onClick={advance} icon={<ChevronRight className="h-4 w-4" />} data-testid="check-next">
                {t('c2.next')}
              </Button>
            ) : (
              <Button onClick={() => void check()} disabled={pick === null} loading={answer.isPending} data-testid="check-submit">
                {t('c2.check')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
