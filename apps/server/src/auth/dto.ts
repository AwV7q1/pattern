import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsString()
  @Length(1, 200)
  password!: string;
}

export class SignupDto extends LoginDto {
  @IsString()
  @Length(8, 200, { message: 'mật khẩu cần ít nhất 8 ký tự' })
  declare password: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  displayName?: string;
}

export class ChangePasswordDto {
  @IsString()
  @Length(1, 200)
  current!: string;

  @IsString()
  @Length(8, 200, { message: 'mật khẩu cần ít nhất 8 ký tự' })
  next!: string;
}

export class UpdateProfileDto {
  @IsString()
  @Length(1, 40)
  displayName!: string;
}
