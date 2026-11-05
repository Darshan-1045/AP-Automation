from django.contrib.auth import authenticate, get_user_model, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models.functions import Lower
from django.db.utils import IntegrityError
from uuid import uuid4
from rest_framework import serializers, status
from rest_framework.authtoken.views import ObtainAuthToken
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.authtoken.models import Token
from .permissions import (
    ADMIN_ROLE,
    AP_MANAGER_ROLE,
    FINANCE_ROLE,
    has_any_role,
)


User = get_user_model()


def _full_name(user):
    return user.get_full_name().strip() or user.get_username()


class RegistrationSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=255, trim_whitespace=True)
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    confirm_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_email(self, value):
        value = value.strip().lower()
        if (
            User.objects.annotate(email_lower=Lower("email"))
            .filter(email_lower=value)
            .exists()
            or User.objects.filter(username__iexact=value).exists()
        ):
            raise serializers.ValidationError(
                "An account with this email already exists."
            )
        return value

    def validate(self, attrs):
        if attrs["password"] != attrs["confirm_password"]:
            raise serializers.ValidationError({
                "confirm_password": "Passwords do not match."
            })
        candidate = User(email=attrs["email"], username=attrs["email"])
        try:
            validate_password(attrs["password"], user=candidate)
        except DjangoValidationError as error:
            raise serializers.ValidationError({
                "password": list(error.messages)
            }) from error
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        full_name = validated_data["full_name"].strip()
        name_parts = full_name.split(maxsplit=1)
        email = validated_data["email"]
        username = email if len(email) <= 150 else f"user-{uuid4().hex}"
        try:
            user = User.objects.create_user(
                username=username,
                email=email,
                first_name=name_parts[0],
                last_name=name_parts[1] if len(name_parts) > 1 else "",
                password=validated_data["password"],
            )
        except IntegrityError as error:
            raise serializers.ValidationError({
                "email": "An account with this email already exists."
            }) from error
        return user


class RegistrationAPIView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(
            {
                "id": user.pk,
                "email": user.email,
                "full_name": _full_name(user),
            },
            status=status.HTTP_201_CREATED,
        )


class EmailTokenAuthView(ObtainAuthToken):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, *args, **kwargs):
        login_serializer = EmailLoginSerializer(data=request.data)
        if not login_serializer.is_valid():
            return Response(
                login_serializer.errors,
                status=status.HTTP_400_BAD_REQUEST,
            )
        email = login_serializer.validated_data["email"].strip().lower()
        password = login_serializer.validated_data["password"]
        user_record = User.objects.filter(email__iexact=email).first()
        username = user_record.get_username() if user_record else email
        user = authenticate(request, username=username, password=password)
        if user is None:
            return Response(
                {"detail": "Invalid email or password."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        token, _ = Token.objects.get_or_create(user=user)
        return Response({
            "token": token.key,
            "username": user.get_username(),
            "email": user.email,
            "full_name": _full_name(user),
        })


class EmailLoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False, write_only=True)


class CurrentUserAPIView(APIView):
    def get(self, request):
        return Response({
            "username": request.user.get_username(),
            "email": request.user.email,
            "full_name": _full_name(request.user),
            "capabilities": {
                "manage_vendors": has_any_role(
                    request.user,
                    {ADMIN_ROLE, AP_MANAGER_ROLE},
                ),
                "view_vendor_bank_details": has_any_role(
                    request.user,
                    {ADMIN_ROLE, AP_MANAGER_ROLE, FINANCE_ROLE},
                ),
                "manage_vendor_bank_details": has_any_role(
                    request.user,
                    {ADMIN_ROLE, AP_MANAGER_ROLE},
                ),
            },
        })


class LogoutAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)
