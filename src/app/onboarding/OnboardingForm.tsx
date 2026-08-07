"use client";

import { useActionState } from "react";
import { completeOnboarding, type OnboardingState } from "./actions";

const STATUS = ["고1", "고2", "고3", "N수", "대학생", "기타"];
const TRACK = ["인문사회", "자연공학", "의약", "사범", "예체능"];

const initial: OnboardingState = { error: null };

export function OnboardingForm({ defaultNickname }: { defaultNickname: string }) {
  const [state, action, pending] = useActionState(completeOnboarding, initial);

  return (
    <form action={action} className="mt-6 space-y-5">
      <Field label="닉네임" hint="2~12자. 게시판과 공개한 선택 이유에 표시됩니다.">
        <input
          name="nickname"
          defaultValue={defaultNickname}
          required
          minLength={2}
          maxLength={12}
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-base outline-none focus:border-accent"
        />
      </Field>

      <Field label="생년월일" hint="만 14세 미만은 가입할 수 없습니다.">
        <input
          type="date"
          name="birth_date"
          required
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-base outline-none focus:border-accent"
        />
      </Field>

      <Field label="신분">
        <div className="flex flex-wrap gap-2">
          {STATUS.map((s) => (
            <Radio key={s} name="status" value={s} />
          ))}
        </div>
      </Field>

      <Field label="계열" hint="통계 분석에 사용됩니다. 나중에 변경할 수 있습니다.">
        <div className="flex flex-wrap gap-2">
          {TRACK.map((t) => (
            <Radio key={t} name="track" value={t} />
          ))}
        </div>
      </Field>

      {state.error && (
        <p className="rounded-md border border-danger-500 bg-surface px-3 py-2 text-sm text-danger-600">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-brand px-4 py-3 text-base font-semibold text-fg-on-brand transition-colors hover:bg-brand-hover disabled:opacity-50"
      >
        {pending ? "저장 중…" : "시작하기"}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-fg">{label}</label>
      {hint && <p className="mb-1.5 mt-0.5 text-2xs text-fg-subtle">{hint}</p>}
      <div className={hint ? "" : "mt-1.5"}>{children}</div>
    </div>
  );
}

function Radio({ name, value }: { name: string; value: string }) {
  return (
    <label className="cursor-pointer">
      <input type="radio" name={name} value={value} required className="peer sr-only" />
      <span className="inline-block rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-fg-muted transition-colors peer-checked:border-accent peer-checked:bg-vote-selected-bg peer-checked:font-semibold peer-checked:text-brand">
        {value}
      </span>
    </label>
  );
}
