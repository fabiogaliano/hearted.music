export interface ProfileAttributes {
	data: Data;
}

export interface Data {
	me: Me;
}

export interface Me {
	profile: Profile;
}

export interface Profile {
	avatar: Avatar | null;
	avatarBackgroundColor: number;
	name: string;
	uri: string;
	username: string;
}

export interface Avatar {
	sources: Source[];
}

export interface Source {
	height: number;
	url: string;
	width: number;
}
