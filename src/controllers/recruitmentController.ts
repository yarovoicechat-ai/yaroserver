import { Request, Response } from 'express';
import { RecruitmentApplication, RecruitmentRole, ApplicationStatus } from '../models/recruitmentApplication.model';
import { User } from '../models/user.model';
import { Request as RequestModel, RequestStatus } from '../models/request.model';
import sendResponse from '../utils/reponse';
import { Logger } from '../utils/logger';
import { sendRecruitmentWorkflowNotification } from '../services/recruitmentNotification';
import { automateEmployeeCreationOnApproval } from '../services/employeeLifecycleService';
import { generateStrongPassword } from './emsController';
import { HierarchyScopeService } from '../utils/hierarchyScope';
import { firstPlayableVoiceUrl } from '../utils/voiceMedia';
import { ROLE_APPROVAL_CONFIG, normalizeRoleKey, canActOnRequest } from '../utils/emsApprovalRules';
import { isYaroIdMandatoryRole, applyInAppRoleOption } from '../utils/appRoleService';

const RECRUITMENT_ROLE_RANK: Record<string, number> = {
    owner: 0,
    operator: 1,
    'super-admin': 2,
    superadmin: 2,
    'bd-leader': 3,
    admin: 3,
    bd: 4,
    agency: 4,
    seller: 5,
    coinseller: 5,
    'customer-service': 5,
    customersupport: 5,
    host: 6,
};

const normalizeRecruitmentRole = (role: string) => {
    const compact = role.toLowerCase().replace(/[\s_]/g, '-');
    const aliases: Record<string, RecruitmentRole> = {
        superadmin: 'super-admin',
        'super-admin': 'super-admin',
        coinseller: 'seller',
        'coin-seller': 'seller',
        customersupport: 'customer-service',
        'customer-support': 'customer-service',
        bdleader: 'bd-leader',
        'bd-leader': 'bd-leader',
        bd: 'bd',
    };
    return (aliases[compact] || compact) as RecruitmentRole;
};

// Helper to generate unique application ID
const generateApplicationId = (role: string): string => {
    const rolePrefixes: Record<string, string> = {
        agency: 'AGY',
        operator: 'OPR',
        admin: 'ADM',
        'customer-service': 'CS',
        'super-admin': 'SA',
        bd: 'BD',
        'bd-leader': 'BDL',
    };
    const prefix = rolePrefixes[role] || 'APP';
    const randNum = Math.floor(10000 + Math.random() * 90000);
    return `APP-${prefix}-${randNum}`;
};

// 1. Verify Referral Code Endpoint
export const verifyReferralCode = async (req: Request, res: Response) => {
    try {
        const code = (req.query.code || req.params.code || '').toString().trim();
        if (!code) {
            return sendResponse(res, 400, false, 'Referral code is required');
        }

        const cleanCode = code.toUpperCase();
        const escapedCode = cleanCode.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        const codeRegex = new RegExp(`^${escapedCode}$`, 'i');

        let senior: any = await User.findOne({
            $or: [
                { employeeCode: codeRegex },
                { referralCode: codeRegex },
                { specialCode: codeRegex },
                { meethiId: codeRegex },
                { userName: codeRegex }
            ],
            isDeleted: { $ne: true }
        }).select('_id name role employeeCode referralCode specialCode');

        // Fallback for role-prefixed special referral codes (e.g. OS000001, OS001, OWN001, OPR001)
        if (!senior) {
            if (cleanCode.startsWith('OS') || cleanCode.startsWith('OWN')) {
                senior = await User.findOne({ role: 'owner', isDeleted: { $ne: true } })
                    .select('_id name role employeeCode referralCode specialCode');
                if (!senior) {
                    return sendResponse(res, 200, true, 'Referral code verified successfully', {
                        code: cleanCode,
                        referrerId: '650000000000000000000001',
                        referrerName: 'Executive Owner',
                        referrerRole: 'owner',
                    });
                }
            } else if (cleanCode.startsWith('OPR')) {
                senior = await User.findOne({ role: 'operator', isDeleted: { $ne: true } })
                    .select('_id name role employeeCode referralCode specialCode');
            } else if (cleanCode.startsWith('SA')) {
                senior = await User.findOne({ role: { $in: ['superAdmin', 'super-admin'] }, isDeleted: { $ne: true } })
                    .select('_id name role employeeCode referralCode specialCode');
            } else if (cleanCode.startsWith('ADM')) {
                senior = await User.findOne({ role: 'admin', isDeleted: { $ne: true } })
                    .select('_id name role employeeCode referralCode specialCode');
            } else if (cleanCode.startsWith('AGY')) {
                senior = await User.findOne({ role: 'agency', isDeleted: { $ne: true } })
                    .select('_id name role employeeCode referralCode specialCode');
            }
        }

        if (senior) {
            return sendResponse(res, 200, true, 'Referral code verified successfully', {
                code: senior.employeeCode || senior.referralCode || senior.specialCode || cleanCode,
                referrerId: senior._id,
                referrerName: senior.name || 'Verified Inviter',
                referrerRole: senior.role || 'owner',
            });
        }

        return sendResponse(res, 404, false, 'Invalid or inactive referral code');
    } catch (error: any) {
        await Logger('verifyReferralCode', error);
        return sendResponse(res, 500, false, 'Error verifying referral code');
    }
};

// 2. Submit Recruitment Application Endpoint
export const submitApplication = async (req: Request, res: Response) => {
    try {
        const roleFromParams = req.params.role as RecruitmentRole;
        const body = req.body || {};
        const role = normalizeRecruitmentRole(roleFromParams || body.role || '');

        const validRoles: RecruitmentRole[] = ['agency', 'operator', 'admin', 'customer-service', 'super-admin', 'seller', 'host', 'bd', 'bd-leader'];
        if (!validRoles.includes(role)) {
            return sendResponse(res, 400, false, `Invalid role. Allowed roles: ${validRoles.join(', ')}`);
        }

        const {
            name,
            email,
            phone,
            gender,
            country,
            city,
            address,
            experienceYears,
            referralCode,
            documents,
            ...roleSpecificFields
        } = body;

        const applicantName = name || body.fullName || body.applicantName || roleSpecificFields.businessName || roleSpecificFields.fullName || 'Applicant';
        const applicantEmail = email || body.confidentialEmail || body.applicantEmail || body.emailId || roleSpecificFields.emailId || roleSpecificFields.officialEmail || roleSpecificFields.confidentialEmail || '';
        const applicantPhone = phone || body.directPhone || body.applicantPhone || body.mobileNo || body.phoneNumber || roleSpecificFields.mobileNo || roleSpecificFields.phoneNumber || roleSpecificFields.directPhone || '';

        if (!applicantEmail || !applicantPhone) {
            return sendResponse(res, 400, false, 'Email and Phone Number are required.');
        }

        // Check for existing pending/under_review application for same role
        const existingApp = await RecruitmentApplication.findOne({
            'applicant.email': applicantEmail.toLowerCase(),
            role,
            status: { $in: ['pending', 'under_review', 'interview_scheduled'] }
        });

        if (existingApp) {
            return sendResponse(res, 400, false, `An active application for ${role.toUpperCase()} already exists with this email.`);
        }

        // MANDATORY: Yaro ID is mandatory for BD, BD Leader, Agency, and Host applications
        const normRole = (role || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const isYaroMandatory = isYaroIdMandatoryRole(normRole);
        const rawYaroId = (body.yaroId || body.userId || body.meethiChatId || body.mithiChatId || roleSpecificFields.yaroId || roleSpecificFields.userId || roleSpecificFields.meethiChatId || roleSpecificFields.meethiLiveId || '').toString().trim();

        let linkedUser: any = null;
        if (isYaroMandatory) {
            if (!rawYaroId) {
                return sendResponse(res, 400, false, `Yaro ID is mandatory for ${role.toUpperCase()} application. Please enter your registered Yaro User ID.`);
            }

            const yaroNum = Number(rawYaroId);
            linkedUser = await User.findOne({
                $or: [
                    { userId: !isNaN(yaroNum) ? yaroNum : -1 },
                    { meethiId: rawYaroId },
                    { employeeCode: rawYaroId },
                    { specialCode: rawYaroId },
                ],
                isDeleted: { $ne: true }
            });

            if (!linkedUser && rawYaroId.length === 24) {
                linkedUser = await User.findById(rawYaroId);
            }

            if (!linkedUser) {
                return sendResponse(res, 400, false, `Invalid Yaro ID: No active account found for Yaro ID "${rawYaroId}". Please provide a valid registered Yaro User ID.`);
            }
        } else if (rawYaroId) {
            const yaroNum = Number(rawYaroId);
            linkedUser = await User.findOne({
                $or: [
                    { userId: !isNaN(yaroNum) ? yaroNum : -1 },
                    { meethiId: rawYaroId },
                ],
                isDeleted: { $ne: true }
            });
        }

        // MANDATORY: Referral code is required for all role applications
        const codeToValidate = (referralCode || body.referrer || body.invitedBy || '').toString().trim();
        if (!codeToValidate) {
            return sendResponse(res, 400, false, 'A valid referral code is required to apply for this role. Submissions without a referral link/code are disabled.');
        }

        let referrerData: any = undefined;
        const cleanCodeToValidate = codeToValidate.toUpperCase();
        const escapedCode = cleanCodeToValidate.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        const codeRegex = new RegExp(`^${escapedCode}$`, 'i');

        let senior: any = await User.findOne({
            $or: [
                { employeeCode: codeRegex },
                { referralCode: codeRegex },
                { specialCode: codeRegex },
                { meethiId: codeRegex },
                { userName: codeRegex }
            ],
            isDeleted: { $ne: true }
        }).select('_id name role employeeCode referralCode specialCode ownerId operatorId superAdminId adminId bdLeaderId bdId agencyId hierarchyPath');

        if (!senior) {
            if (cleanCodeToValidate.startsWith('OS') || cleanCodeToValidate.startsWith('OWN')) {
                senior = await User.findOne({ role: 'owner', isDeleted: { $ne: true } })
                    .select('_id name role employeeCode referralCode specialCode ownerId operatorId superAdminId adminId bdLeaderId bdId agencyId hierarchyPath');
                if (!senior) {
                    senior = {
                        _id: '650000000000000000000001',
                        name: 'Executive Owner',
                        role: 'owner',
                        specialCode: cleanCodeToValidate
                    };
                }
            } else if (cleanCodeToValidate.startsWith('OPR')) {
                senior = await User.findOne({ role: 'operator', isDeleted: { $ne: true } })
                    .select('_id name role employeeCode referralCode specialCode ownerId operatorId superAdminId adminId bdLeaderId bdId agencyId hierarchyPath');
            } else if (cleanCodeToValidate.startsWith('SA')) {
                senior = await User.findOne({ role: { $in: ['superAdmin', 'super-admin'] }, isDeleted: { $ne: true } })
                    .select('_id name role employeeCode referralCode specialCode ownerId operatorId superAdminId adminId bdLeaderId bdId agencyId hierarchyPath');
            } else if (cleanCodeToValidate.startsWith('ADM')) {
                senior = await User.findOne({ role: 'admin', isDeleted: { $ne: true } })
                    .select('_id name role employeeCode referralCode specialCode ownerId operatorId superAdminId adminId bdLeaderId bdId agencyId hierarchyPath');
            } else if (cleanCodeToValidate.startsWith('AGY')) {
                senior = await User.findOne({ role: 'agency', isDeleted: { $ne: true } })
                    .select('_id name role employeeCode referralCode specialCode ownerId operatorId superAdminId adminId bdLeaderId bdId agencyId hierarchyPath');
            } else if (cleanCodeToValidate.startsWith('BDL')) {
                senior = await User.findOne({ role: 'bd-leader', isDeleted: { $ne: true } })
                    .select('_id name role employeeCode referralCode specialCode ownerId operatorId superAdminId adminId bdLeaderId bdId agencyId hierarchyPath');
            } else if (cleanCodeToValidate.startsWith('BD')) {
                senior = await User.findOne({ role: 'bd', isDeleted: { $ne: true } })
                    .select('_id name role employeeCode referralCode specialCode ownerId operatorId superAdminId adminId bdLeaderId bdId agencyId hierarchyPath');
            }
        }

        if (senior) {
            const referrerRole = normalizeRecruitmentRole(String(senior.role || 'owner'));
            const referrerRank = RECRUITMENT_ROLE_RANK[referrerRole];
            const targetRank = RECRUITMENT_ROLE_RANK[role];
            if (referrerRank !== undefined && targetRank !== undefined && targetRank <= referrerRank && (referrerRole as string) !== 'owner') {
                return sendResponse(
                    res,
                    403,
                    false,
                    `A ${senior.role} cannot refer the same or a higher role.`
                );
            }
            referrerData = {
                code: senior.referralCode || senior.employeeCode || senior.specialCode || cleanCodeToValidate,
                referrerId: senior._id,
                referrerRole: senior.role || 'owner',
                referrerName: senior.name || 'Executive Owner'
            };
        } else {
            return sendResponse(res, 400, false, 'Invalid or inactive referral code.');
        }

        // Resolve complete upstream ancestry for strict branch isolation
        const seniorOwnerId = senior.ownerId || (senior.role === 'owner' ? senior._id : undefined);
        const seniorOperatorId = senior.operatorId || (senior.role === 'operator' ? senior._id : undefined);
        const seniorSuperAdminId = senior.superAdminId || (['superAdmin', 'super-admin'].includes(senior.role) ? senior._id : undefined);
        const seniorAdminId = senior.adminId || (senior.role === 'admin' ? senior._id : undefined);
        const seniorBdLeaderId = senior.bdLeaderId || (['bdLeader', 'bd-leader'].includes(senior.role) ? senior._id : undefined);
        const seniorBdId = senior.bdId || (senior.role === 'bd' ? senior._id : undefined);
        const seniorAgencyId = senior.agencyId || (senior.role === 'agency' ? senior._id : undefined);
        const seniorHierarchyPath = `${senior.hierarchyPath || ''}/${senior._id}`.replace(/\/+/g, '/');

        // Parse documents
        let parsedDocs: Array<{ name: string; documentType: string; url: string }> = [];
        if (Array.isArray(documents)) {
            parsedDocs = documents.map((doc: any, idx: number) => {
                if (typeof doc === 'string') {
                    return { name: `Document ${idx + 1}`, documentType: 'Upload', url: doc };
                }
                return {
                    name: doc.name || `Document ${idx + 1}`,
                    documentType: doc.documentType || 'Upload',
                    url: doc.url || doc
                };
            });
        }

        const applicationId = generateApplicationId(role);

        const newApplication = await RecruitmentApplication.create({
            applicationId,
            role,
            status: 'pending',
            applicant: {
                name: applicantName,
                email: applicantEmail.toLowerCase(),
                phone: applicantPhone,
                gender: gender || 'other',
                country: country || 'India',
                city: city || '',
                address: address || '',
                experienceYears: experienceYears || '',
                yaroId: linkedUser ? String(linkedUser.userId) : (rawYaroId || undefined),
                userId: linkedUser ? linkedUser.userId : (Number(rawYaroId) || undefined),
            },
            roleData: {
                ...roleSpecificFields,
                yaroId: linkedUser ? String(linkedUser.userId) : (rawYaroId || undefined),
                userId: linkedUser ? linkedUser.userId : (Number(rawYaroId) || undefined),
                ownerId: seniorOwnerId ? String(seniorOwnerId) : undefined,
                operatorId: seniorOperatorId ? String(seniorOperatorId) : undefined,
                superAdminId: seniorSuperAdminId ? String(seniorSuperAdminId) : undefined,
                adminId: seniorAdminId ? String(seniorAdminId) : undefined,
                bdLeaderId: seniorBdLeaderId ? String(seniorBdLeaderId) : undefined,
                bdId: seniorBdId ? String(seniorBdId) : undefined,
                agencyId: seniorAgencyId ? String(seniorAgencyId) : undefined,
                hierarchyPath: seniorHierarchyPath,
            },
            documents: parsedDocs,
            referrer: referrerData,
            reviewNotes: [{
                authorName: 'System',
                text: 'Application submitted successfully.',
                timestamp: new Date()
            }]
        });

        // Automatically sync to EMS Request Center for the role's Request Page (e.g. Operator Request, Admin Request, Super Admin Request)
        const roleToRequestTypeMap: Record<string, string> = {
            operator: 'Operator Request',
            admin: 'Admin Request',
            'super-admin': 'Super Admin Request',
            agency: 'Agency Request',
            'customer-service': 'Customer Support Request',
            host: 'Host Request',
            seller: 'Seller Request',
            coinseller: 'Seller Request',
            bd: 'BD Request',
            'bd-leader': 'BD Leader Request',
        };

        const requestType = roleToRequestTypeMap[role];
        if (requestType) {
            try {
                const resumeDoc = parsedDocs.find(d => d.documentType === 'Resume' || d.name?.toLowerCase().includes('resume'));
                const adharFrontDoc = parsedDocs.find(d => d.name?.toLowerCase().includes('front') || d.documentType === 'GovtID');
                const adharBackDoc = parsedDocs.find(d => d.name?.toLowerCase().includes('back'));
                const panDoc = parsedDocs.find(d => d.name?.toLowerCase().includes('pan') || d.documentType === 'Certificate');
                const voiceDoc = parsedDocs.find(d =>
                    d.documentType === 'Voice' ||
                    d.documentType === 'Audio' ||
                    d.name?.toLowerCase().includes('voice') ||
                    d.name?.toLowerCase().includes('audition')
                );

                const voiceUrl = firstPlayableVoiceUrl(
                    body.voiceAudioUrl,
                    body.audio,
                    body.voice,
                    voiceDoc?.url
                );

                const generatedPassword = generateStrongPassword(applicantName, applicantPhone, applicantEmail);
                const targetWorkflowConfig = ROLE_APPROVAL_CONFIG[normalizeRoleKey(role)];
                const workflowSteps = targetWorkflowConfig ? [...targetWorkflowConfig.steps] : [];

                await RequestModel.create({
                    requestType,
                    role,
                    workflowSteps,
                    passwordBeforeApproval: generatedPassword,
                    referralCode: referrerData?.code || referralCode || '',
                    referralUserId: referrerData?.referrerId ? referrerData.referrerId.toString() : '',
                    referralOwner: referrerData?.referrerName || '',
                    referralRole: referrerData?.referrerRole || '',
                    generatedUserId: linkedUser ? linkedUser.userId : (rawYaroId && !isNaN(Number(rawYaroId)) ? Number(rawYaroId) : undefined),
                    data: {
                        name: applicantName,
                        email: applicantEmail.toLowerCase(),
                        phoneNumber: applicantPhone,
                        mobile: applicantPhone,
                        password: generatedPassword,
                        gender: gender || 'other',
                        country: country || 'India',
                        city: city || '',
                        address: address || '',
                        experience: experienceYears || '',
                        yaroId: linkedUser ? String(linkedUser.userId) : (rawYaroId || undefined),
                        userId: linkedUser ? linkedUser.userId : (rawYaroId && !isNaN(Number(rawYaroId)) ? Number(rawYaroId) : undefined),
                        referralCode: referrerData?.code || referralCode || '',
                        invitedBy: referrerData?.referrerName || (referralCode ? `Referral Code: ${referralCode}` : 'Direct Recruitment Portal'),
                        parentOperator: seniorOperatorId ? String(seniorOperatorId) : (referrerData?.code || ''),
                        parentOwner: seniorOwnerId ? String(seniorOwnerId) : (referrerData?.code || ''),
                        ownerId: seniorOwnerId ? String(seniorOwnerId) : undefined,
                        operatorId: seniorOperatorId ? String(seniorOperatorId) : undefined,
                        superAdminId: seniorSuperAdminId ? String(seniorSuperAdminId) : undefined,
                        adminId: seniorAdminId ? String(seniorAdminId) : undefined,
                        bdLeaderId: seniorBdLeaderId ? String(seniorBdLeaderId) : undefined,
                        bdId: seniorBdId ? String(seniorBdId) : undefined,
                        agencyId: seniorAgencyId ? String(seniorAgencyId) : undefined,
                        hierarchyPath: seniorHierarchyPath,
                        mithiChatId: applicationId,
                        meethiChatId: applicationId,
                        resume: resumeDoc?.url || '',
                        adharFront: adharFrontDoc?.url || '',
                        adharBack: adharBackDoc?.url || '',
                        pan: panDoc?.url || '',
                        audio: voiceUrl,
                        voiceAudioUrl: voiceUrl,
                        voice: voiceUrl,
                        documents: parsedDocs,
                        specialCode: roleSpecificFields.specialCode || roleSpecificFields.adminCode || roleSpecificFields.superAdminCode || roleSpecificFields.operatorCode || '',
                        ...roleSpecificFields
                    },
                    status: RequestStatus.PENDING,
                    createdBy: referrerData?.referrerId || 'public_recruitment',
                    createdByRole: referrerData?.referrerRole || 'public'
                });
            } catch (reqErr) {
                await Logger('submitApplicationEMSRequestSyncError', reqErr);
            }
        }

        return sendResponse(res, 201, true, 'Recruitment application submitted successfully!', {
            applicationId: newApplication.applicationId,
            role: newApplication.role,
            status: newApplication.status,
            createdAt: newApplication.createdAt
        });
    } catch (error: any) {
        await Logger('submitApplication', error);
        return sendResponse(res, 500, false, error.message || 'Failed to submit application');
    }
};

// 3. Admin: List Applications
export const getAdminApplications = async (req: Request, res: Response) => {
    try {
        const { role, status, search, page = 1, limit = 20 } = req.query;
        const query: any = {};

        if (role && role !== 'all') {
            query.role = role;
        }

        if (status && status !== 'all') {
            query.status = status;
        }

        const currentUser = (req as any).user;
        if (currentUser) {
            const currentUserIdStr = (currentUser._id || currentUser.id || '').toString();
            if (currentUser.role === 'operator') {
                const ownerInfo = await HierarchyScopeService.getOwnerReferralInfo();
                const exclusionFilter = HierarchyScopeService.buildOwnerReferralExclusionFilter('operator', 'recruitment', ownerInfo);
                if (Object.keys(exclusionFilter).length > 0) {
                    Object.assign(query, exclusionFilter);
                }
            }

            const scopeFilter = HierarchyScopeService.buildRequestScope({
                id: currentUserIdStr,
                role: currentUser.role || 'user'
            });

            if (Object.keys(scopeFilter).length > 0) {
                query.$and = query.$and || [];
                query.$and.push(scopeFilter);
            }
        }

        if (search) {
            const searchRegex = new RegExp(search.toString().trim(), 'i');
            query.$or = [
                { applicationId: searchRegex },
                { 'applicant.name': searchRegex },
                { 'applicant.email': searchRegex },
                { 'applicant.phone': searchRegex },
                { 'referrer.code': searchRegex }
            ];
        }

        const pageNum = parseInt(page.toString(), 10) || 1;
        const limitNum = parseInt(limit.toString(), 10) || 20;
        const skip = (pageNum - 1) * limitNum;

        const [applications, total] = await Promise.all([
            RecruitmentApplication.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            RecruitmentApplication.countDocuments(query)
        ]);

        return sendResponse(res, 200, true, 'Applications retrieved successfully', {
            applications,
            total,
            page: pageNum,
            totalPages: Math.ceil(total / limitNum)
        });
    } catch (error: any) {
        await Logger('getAdminApplications', error);
        return sendResponse(res, 500, false, 'Failed to fetch applications');
    }
};

// 4. Admin: Get Single Application
export const getApplicationById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const application = await RecruitmentApplication.findOne({
            $or: [{ _id: id }, { applicationId: id }]
        }).lean();

        if (!application) {
            return sendResponse(res, 404, false, 'Application not found');
        }

        const currentUser = (req as any).user;
        if (currentUser?.role === 'operator') {
            const ownerInfo = await HierarchyScopeService.getOwnerReferralInfo();
            if (HierarchyScopeService.isOwnerReferral(application, 'recruitment', ownerInfo)) {
                return sendResponse(res, 403, false, 'Access Denied: Owner referral applications are restricted to Owner.');
            }
        }

        return sendResponse(res, 200, true, 'Application details retrieved', application);
    } catch (error: any) {
        await Logger('getApplicationById', error);
        return sendResponse(res, 500, false, 'Failed to fetch application details');
    }
};

// 5. Admin: Update Application Status
export const updateApplicationStatus = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { status, note } = req.body;

        const application = await RecruitmentApplication.findOne({
            $or: [{ _id: id }, { applicationId: id }]
        });

        if (!application) {
            return sendResponse(res, 404, false, 'Application not found');
        }

        const currentUser = (req as any).user;
        if (currentUser?.role === 'operator') {
            const ownerInfo = await HierarchyScopeService.getOwnerReferralInfo();
            if (HierarchyScopeService.isOwnerReferral(application, 'recruitment', ownerInfo)) {
                return sendResponse(res, 403, false, 'Access Denied: Owner referral applications are restricted to Owner.');
            }
        }

        if (status === 'approved') {
            const actionEval = canActOnRequest(
                { id: currentUser?._id || currentUser?.id, role: currentUser?.role },
                application
            );
            if (!actionEval.canAct) {
                return sendResponse(res, 403, false, actionEval.reason || 'Verification failure: Unauthorized to approve this application.');
            }
        }

        const prevStatus = application.status;
        application.status = status;

        const authorName = (req as any).user?.name || 'Admin';
        const authorId = (req as any).user?._id;

        application.reviewNotes.push({
            authorName,
            authorId,
            text: note || `Status changed from ${prevStatus.toUpperCase()} to ${status.toUpperCase()}`,
            statusChange: status as ApplicationStatus,
            timestamp: new Date()
        });

        await application.save();

        // Dispatch background notification trigger
        sendRecruitmentWorkflowNotification({
            applicantName: application.applicant?.name,
            applicantEmail: application.applicant?.email,
            applicationId: application.applicationId,
            role: application.role,
            status,
            customNote: note
        }).catch(() => {});

        // Automate Employee Creation & In-App Role Option on Approval
        if (status === 'approved') {
            const shouldEnableAppAccess = req.body.enableAppAccess !== undefined
                ? Boolean(req.body.enableAppAccess)
                : (req.body.grantAppOption !== undefined ? Boolean(req.body.grantAppOption) : true);

            try {
                const targetYaroId = application.applicant?.yaroId || application.applicant?.userId || (application.roleData as any)?.yaroId || (application.roleData as any)?.userId;
                const userQuery: any[] = [];
                if (targetYaroId && !isNaN(Number(targetYaroId))) {
                    userQuery.push({ userId: Number(targetYaroId) });
                    userQuery.push({ meethiId: String(targetYaroId) });
                }
                if (application.applicant?.email) {
                    userQuery.push({ email: application.applicant.email.toLowerCase() });
                }
                if (userQuery.length > 0) {
                    const targetUser = await User.findOne({ $or: userQuery });
                    if (targetUser) {
                        await applyInAppRoleOption(targetUser, application.role, { enableAppAccess: shouldEnableAppAccess });
                    }
                }
            } catch (roleOptErr) {
                await Logger('updateApplicationStatusRoleOptionError', roleOptErr);
            }

            automateEmployeeCreationOnApproval(application.applicationId).catch(() => {});
        }

        return sendResponse(res, 200, true, `Application status updated to ${status}`, application);
    } catch (error: any) {
        await Logger('updateApplicationStatus', error);
        return sendResponse(res, 500, false, 'Failed to update application status');
    }
};

// 6. Admin: Add Review Note
export const addReviewNote = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { note } = req.body;

        if (!note || !note.trim()) {
            return sendResponse(res, 400, false, 'Note text is required');
        }

        const application = await RecruitmentApplication.findOne({
            $or: [{ _id: id }, { applicationId: id }]
        });

        if (!application) {
            return sendResponse(res, 404, false, 'Application not found');
        }

        const authorName = (req as any).user?.name || 'Admin';
        const authorId = (req as any).user?._id;

        application.reviewNotes.push({
            authorName,
            authorId,
            text: note.trim(),
            timestamp: new Date()
        });

        await application.save();

        return sendResponse(res, 200, true, 'Review note added successfully', application.reviewNotes);
    } catch (error: any) {
        await Logger('addReviewNote', error);
        return sendResponse(res, 500, false, 'Failed to add review note');
    }
};
