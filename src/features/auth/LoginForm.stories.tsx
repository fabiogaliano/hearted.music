import type { Story } from "@ladle/react";
import { LoginForm } from "@/features/auth/LoginForm";

export default {
	title: "Email/Pass/LoginForm",
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
