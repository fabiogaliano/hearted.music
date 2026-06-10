import type { Story } from "@ladle/react";
import { LoginForm } from "@/features/auth/LoginForm";

export default {
	title: "Auth/LoginForm",
};

const noop = async () => {};

type StoryProps = Partial<Parameters<typeof LoginForm>[0]>;

function makeStory(props: StoryProps): Story {
	return () => (
		<LoginForm
			mode="signin"
			onModeChange={() => {}}
			onSubmit={noop}
			onGoogle={noop}
			onForgotPassword={() => {}}
			error={null}
			notice={null}
			loading={null}
			{...props}
		/>
	);
}

export const ChoiceIdle: Story = makeStory({});

export const ChoiceGoogleRedirecting: Story = makeStory({
	loading: "google",
});

export const ChoiceGoogleError: Story = makeStory({
	error: "Something went sideways. Let's try that again.",
});

export const CredentialsSignInIdle: Story = makeStory({
	initialPanel: "credentials",
});

export const CredentialsSignUpIdle: Story = makeStory({
	initialPanel: "credentials",
	mode: "signup",
});

export const CredentialsSignInLoading: Story = makeStory({
	initialPanel: "credentials",
	loading: "credentials",
});

export const CredentialsSignInError: Story = makeStory({
	initialPanel: "credentials",
	error: "That email and password don't match.",
});

export const CredentialsSignUpExistingUserError: Story = makeStory({
	initialPanel: "credentials",
	mode: "signup",
	error: "An account with that email already exists. Try signing in.",
});

export const CredentialsSignInWithNotice: Story = makeStory({
	initialPanel: "credentials",
	notice: "Check your inbox to verify this email first.",
});

// The state the user lands on right after creating an account: switched to
// sign-in mode with the verification notice. Matches login.tsx's signup branch.
export const CredentialsPostSignupVerification: Story = makeStory({
	initialPanel: "credentials",
	mode: "signin",
	notice:
		"One step left. We sent a verification link to reader@hearted.music. If it's not in your inbox, check spam.",
});
